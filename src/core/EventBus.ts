/**
 * ==========================================================
 * LÉLU
 * EVENT BUS
 * ==========================================================
 */

export type EventHandler<T = unknown> =
  (payload: T) => void | Promise<void>;

export interface EventMessage<T = unknown> {

  type:
    string;

  payload:
    T;

  timestamp:
    number;

}

export default class EventBus {

  private readonly listeners =
    new Map<
      string,
      Set<EventHandler>
    >();

  /**
   * Subscribe to an event.
   */
  public on<T = unknown>(

    event:
      string,

    handler:
      EventHandler<T>,

  ): () => void {

    if (

      !this.listeners.has(
        event,
      )

    ) {

      this.listeners.set(

        event,

        new Set(),

      );

    }

    this.listeners
      .get(event)!
      .add(
        handler as EventHandler,
      );

    return () => {

      this.off(

        event,

        handler,

      );

    };

  }

  /**
   * Subscribe once.
   */
  public once<T = unknown>(

    event:
      string,

    handler:
      EventHandler<T>,

  ): () => void {

    const wrapper:

      EventHandler<T> =

      async payload => {

        this.off(

          event,

          wrapper,

        );

        await handler(
          payload,
        );

      };

    return this.on(

      event,

      wrapper,

    );

  }

  /**
   * Remove listener.
   */
  public off<T = unknown>(

    event:
      string,

    handler:
      EventHandler<T>,

  ): void {

    this.listeners
      .get(event)
      ?.delete(
        handler as EventHandler,
      );

    if (

      this.listeners
        .get(event)
        ?.size === 0

    ) {

      this.listeners.delete(
        event,
      );

    }

  }

  /**
   * Emit an event.
   */
  public async emit<T = unknown>(

    event:
      string,

    payload:
      T,

  ): Promise<void> {

    const handlers =
      this.listeners.get(
        event,
      );

    if (

      handlers ===
      undefined

    ) {

      return;

    }

    const message:

      EventMessage<T> = {

      type:
        event,

      payload,

      timestamp:
        Date.now(),

    };

    for (

      const handler of
      handlers

    ) {

      await handler(
        message.payload,
      );

    }

  }

  /**
   * Whether listeners exist.
   */
  public has(

    event:
      string,

  ): boolean {

    return (

      this.listeners.has(
        event,
      )

    );

  }

  /**
   * Listener count.
   */
  public count(

    event:
      string,

  ): number {

    return (

      this.listeners
        .get(event)
        ?.size ??

      0

    );

  }

  /**
   * Registered events.
   */
  public events():
    string[] {

    return Array.from(

      this.listeners.keys(),

    );

  }

  /**
   * Remove everything.
   */
  public clear():
    void {

    this.listeners.clear();

  }

}