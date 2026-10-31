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

/**
 * Is this a console where a collapsed group and a table are real?
 *
 * A browser devtools console renders both; Node prints a flat list and an
 * ASCII table, and under the test runner the table breaks the reporter's
 * framing outright. The check is for a real `window`/`document`, not merely
 * for the methods existing — Node defines `console.table` too, which is
 * exactly how this went unnoticed. Tests that shim `window = globalThis`
 * are therefore still treated as a browser, so a shim must not also claim
 * a `document`; none of them do.
 */
function supportsConsoleGroups(): boolean {
  const candidate = globalThis as { document?: unknown; window?: unknown };
  return typeof candidate.document !== "undefined" && typeof candidate.window !== "undefined";
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
   * Print one log line.
   *
   * `console.groupCollapsed` and `console.table` are browser devtools
   * affordances: in a devtools console they give a collapsed entry you can
   * expand, which is the whole point of them here. Outside a browser they
   * are neither collapsed nor a table — Node renders the table as ASCII box
   * art, which is noise, and measurably worse than noise.
   *
   * Measured: under `node --test`, console.table's output corrupted the
   * frame the test child uses to report results to the runner, and
   * tests/provider-fallback-cognition.test.ts failed at file level with
   * "Unable to deserialize cloned data" in roughly half of its runs — its
   * assertions all passing, its result unreadable. Silencing console.table
   * alone took that from 4 failures in 6 runs to 0 in 6.
   *
   * So the grouped presentation is used where it means something, and one
   * plain line is used where it does not. Nothing is logged in one case and
   * withheld in the other; only the shape differs.
   */
  private print(
    log:
      ExecutionLog,
  ): void {

    const time =
      new Date(
        log.timestamp,
      ).toLocaleTimeString();

    const browser =
      supportsConsoleGroups();

    // ASCII outside a browser. The dots are a devtools nicety, and a
    // measured hazard anywhere else: under `node --test` the child reports
    // its results to the runner as framed binary messages interleaved with
    // console output, and these two particular multi-byte sequences
    // mis-framed it. The file failed with "Unable to deserialize cloned
    // data" in 2 of 8 runs with them and 0 of 8 without — every assertion
    // passing either way, the result simply unreadable. A log line is worth
    // nothing if printing it loses the test result that follows it.
    const mark =
      browser
        ? (log.success ? "🟢" : "🔴")
        : (log.success ? "OK  " : "FAIL");

    const header =
      `${mark} [${time}] [${log.stage}] ${log.message}`;

    const hasMetadata =
      Boolean(
        log.metadata &&
        Object.keys(
          log.metadata,
        ).length > 0,
      );

    if (
      !browser
    ) {

      const detail =
        [
          log.provider ? `provider=${log.provider}` : "",
          log.duration !== undefined ? `duration=${log.duration}` : "",
          log.confidence !== undefined ? `confidence=${log.confidence}` : "",
        ]
          .filter(Boolean)
          .join(" ");

      console.log(
        detail ? `${header} · ${detail}` : header,
      );

      if (
        hasMetadata
      ) {

        console.log(
          "  metadata:",
          JSON.stringify(
            log.metadata,
          ),
        );

      }

      return;

    }

    console.groupCollapsed(
      header,
    );

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
      hasMetadata
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