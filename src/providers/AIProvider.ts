/**
 * ==========================================================
 * LÉLU
 * AI PROVIDER CONTRACT
 * ==========================================================
 */


export interface AIMessage {

  role:
    "system"
    | "user"
    | "assistant"
    /**
     * A turn carrying the OUTCOME of tool execution. LÉLU's router
     * dispatches the tool; this turn hands the real result back to the
     * model so the next generation is grounded in what actually ran.
     */
    | "tool";


  content:
    string;


  /**
   * Tools the model asked to run on an assistant turn. Present only when
   * the model emitted a native tool call; the text of such a turn is
   * usually empty or a short preamble.
   */
  toolCalls?:
    ToolCall[];


  /**
   * On a "tool" turn, which call this result answers. Providers need it
   * to correlate the result with the invocation — Anthropic matches on
   * tool_use_id, OpenAI on tool_call_id, and Gemini on the function name.
   */
  toolCallId?:
    string;


  /**
   * On a "tool" turn, the name of the tool that produced the result.
   */
  toolName?:
    string;


  /**
   * On a "tool" turn, whether execution failed. A failed tool must be
   * reported to the model AS a failure rather than dropped, or the model
   * silently invents what the tool would have said.
   */
  toolError?:
    boolean;

}



/**
 * A tool offered to the model, in provider-neutral form.
 *
 * Built from the real ToolRegistry — never hand-written — so the set a
 * model is offered is the set LÉLU can actually execute. Advertising a
 * tool with no executor is how a model is induced to claim an action
 * that never happened.
 */
export interface ToolSchema {

  name:
    string;


  description:
    string;


  /** JSON Schema for the tool's arguments. */
  parameters:
    Record<
      string,
      unknown
    >;

}



/**
 * A model's request to run one tool.
 */
export interface ToolCall {

  /**
   * Provider-issued correlation id. Echoed back on the matching tool
   * result turn.
   */
  id:
    string;


  name:
    string;


  arguments:
    Record<
      string,
      unknown
    >;

}



/**
 * A visual attachment (image, or a captured frame from a video)
 * supplied through the chat interface. Data URLs keep the payload
 * self-contained: providers that support multimodal content can
 * pass them straight to their vision models, and providers that
 * do not simply ignore the field — the text prompt still flows
 * through the unchanged pipeline.
 */
export interface MediaAttachment {

  kind:
    "image"
    | "video";

  /**
   * Downscaled JPEG/PNG data URL (images) or the captured frame
   * data URL (videos).
   */
  dataUrl:
    string;

  /**
   * Short human label, e.g. "image.png" or "clip.mp4".
   */
  label?:
    string;

}



export interface AIRequest {


  /**
   * Complete conversation context.
   */
  messages:
    AIMessage[];



  /**
   * Latest user message.
   */
  prompt:
    string;



  /**
   * Optional visual attachments accompanying the prompt.
   */
  media?:
    MediaAttachment[];



  /**
   * Optional memory/context injected
   * before generation.
   */
  context?:
    string;



  /**
   * Timestamp of request.
   */
  timestamp?:
    number;



  /**
   * Optional progressive-output callback. When provided, providers that
   * support streaming deliver the ACCUMULATED text after each chunk so
   * the UI can render the response live instead of waiting for the
   * full completion. Providers without streaming support simply ignore
   * it — fallback behavior is unchanged.
   */
  onDelta?:
    (accumulatedText: string) => void;



  /**
   * Optional model override.
   */
  model?:
    string;



  /**
   * Optional provider preference (agent delegation). The resolver
   * tries these providers first, in order, before falling back to
   * the normal priority chain — so an agent's preferred provider
   * and fallback provider are honored without breaking the global
   * failure fallback.
   */
  preferredProviders?:
    string[];



  /**
   * Tools the model may invoke on this request. Providers that support
   * native tool calling translate these into their own schema; providers
   * that do not simply ignore the field, so the fallback chain is
   * unchanged and a non-tool provider still answers normally.
   */
  tools?:
    ToolSchema[];


  /**
   * Whether this request is a CONVERSATIONAL turn that may use tools.
   *
   * Only the chat path sets it. LÉLU also calls providers internally for
   * structured output — ProjectInterpreter asks for a JSON decision,
   * SelfStudyEngine asks for an evaluation — and those callers parse the
   * reply against a fixed shape. Offering tools on such a call makes the
   * model answer with a tool_use instead of the JSON, the parse fails,
   * and the caller falls back to its regex path while reporting "no
   * provider was reachable" about a provider that answered perfectly.
   *
   * Absent or false means the request behaves exactly as it did before
   * native tool calling existed.
   */
  allowTools?:
    boolean;


  /**
   * Maximum tokens.
   */
  maxTokens?:
    number;



  /**
   * Sampling temperature.
   */
  temperature?:
    number;



  /**
   * Stop sequences.
   */
  stop?:
    string[];

}



export interface AIResponse {


  text:
    string;



  provider:
    string;



  model:
    string;



  processingTime:
    number;



  cached?:
    boolean;



  /**
   * Tools the model asked to run. A non-empty value means the turn is
   * NOT an answer: the router must execute these and generate again.
   */
  toolCalls?:
    ToolCall[];



  /**
   * Why generation stopped. "tool_use" is normalized across providers
   * (Anthropic "tool_use", OpenAI "tool_calls", Gemini a functionCall
   * part) so the loop has one condition to test rather than three.
   */
  stopReason?:
    string;



  metadata?:
    Record<
      string,
      unknown
    >;

}



export interface AIProviderHealth {


  available:
    boolean;



  initialized:
    boolean;



  lastChecked:
    number;



  responseTime?:
    number;



  lastError?:
    string;

}



export default interface AIProvider {


  readonly name:
    string;



  readonly priority:
    number;



  readonly enabled:
    boolean;



  readonly timeout:
    number;



  readonly requiresApiKey:
    boolean;



  readonly capabilities:
    readonly string[];



  /**
   * Whether this provider implements NATIVE tool calling — that is, it
   * translates AIRequest.tools, returns AIResponse.toolCalls, and can
   * accept "tool" turns back.
   *
   * The router reads this rather than inferring from a capabilities
   * string, and offers tools only to providers that answer true. A
   * provider that merely mentions tools in prose does not qualify: the
   * text-salvage path in ToolCallInterceptor exists precisely because
   * that guess used to be made.
   */
  readonly supportsTools?:
    boolean;



  initialize():
    Promise<void>;



  shutdown?():
    Promise<void>;



  isAvailable():
    Promise<boolean>;



  health():
    Promise<AIProviderHealth>;



  canHandle(
    input:
      string,
  ):
    boolean;



  generate(
    request:
      AIRequest,
  ):
    Promise<AIResponse>;

}