/**
 * ==========================================================
 * LÉLU
 * EXECUTION LOGGER
 * ==========================================================
 */

export interface ExecutionLog {

  id: string;

  timestamp: number;

  stage: string;

  success: boolean;

  message: string;

  provider?: string;

  duration?: number;

  confidence?: number;

  metadata?:
    Record<
      string,
      unknown
    >;

}

export default class ExecutionLogger {

  private readonly logs:
    ExecutionLog[] = [];

  /**
   * Record an execution.
   */
  public log(

    entry:
      Omit<
        ExecutionLog,
        "id" |
        "timestamp"
      >,

  ): ExecutionLog {

    const log:
      ExecutionLog = {

      id:
        crypto.randomUUID(),

      timestamp:
        Date.now(),

      ...entry,

    };

    this.logs.push(
      log,

    );

    this.print(
      log,
    );

    return log;

  }

  /**
   * Print to browser console.
   */
  private print(
    log:
      ExecutionLog,
  ): void {

    const time =
      new Date(
        log.timestamp,
      ).toLocaleTimeString();

    const header =
      `[${time}] [${log.stage}]`;

    if (
      log.success
    ) {

      console.groupCollapsed(
        `🟢 ${header} ${log.message}`,
      );

    }

    else {

      console.groupCollapsed(
        `🔴 ${header} ${log.message}`,
      );

    }

    console.table({

      Stage:
        log.stage,

      Success:
        log.success,

      Message:
        log.message,

      Provider:
        log.provider ??
        "-",

      Duration:
        log.duration ??
        "-",

      Confidence:
        log.confidence ??
        "-",

    });

    if (
      log.metadata &&
      Object.keys(
        log.metadata,
      ).length > 0
    ) {

      console.log(
        "Metadata:",
        log.metadata,
      );

    }

    console.groupEnd();

  }

  /**
   * Convenience success log.
   */
  public info(

    stage:
      string,

    message:
      string,

    metadata?:
      Record<
        string,
        unknown
      >,

  ): ExecutionLog {

    return this.log({

      stage,

      message,

      success:
        true,

      metadata,

    });

  }

  /**
   * Convenience error log.
   */
  public error(

    stage:
      string,

    message:
      string,

    metadata?:
      Record<
        string,
        unknown
      >,

  ): ExecutionLog {

    return this.log({

      stage,

      message,

      success:
        false,

      metadata,

    });

  }

  /**
   * Complete history.
   */
  public all():
    readonly ExecutionLog[] {

    return this.logs;

  }

  /**
   * Latest event.
   */
  public latest():
    ExecutionLog |
    undefined {

    return this.logs.at(
      -1,
    );

  }

  /**
   * Successful events.
   */
  public successful():
    ExecutionLog[] {

    return this.logs.filter(

      log =>

        log.success,

    );

  }

  /**
   * Failed events.
   */
  public failures():
    ExecutionLog[] {

    return this.logs.filter(

      log =>

        !log.success,

    );

  }

  /**
   * Reset history.
   */
  public clear():
    void {

    this.logs.length =
      0;

  }

}