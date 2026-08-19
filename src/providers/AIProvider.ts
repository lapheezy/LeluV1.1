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
    | "assistant";


  content:
    string;

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