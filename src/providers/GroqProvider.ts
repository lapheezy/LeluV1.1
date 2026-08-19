 /**
   [oai_citation:0‡GroqCloud](https://console.groq.com/docs/api-reference?utm_source=chatgpt.com)==================
  * LÉLU
  * GROQ PROVIDER
  * ==========================================================
  *
  * Responsibilities:
  * - Load the Groq API key from Vite/runtime environments
  * - Verify that Groq is actually available
  * - Send OpenAI-compatible chat completion requests
  * - Return a real AIResponse only on success
  * - Throw on failure so ProviderResolver can try another provider
  *
  * Groq currently supports the OpenAI-compatible chat completions
  * endpoint and the llama-3.3-70b-versatile model.
  */

 import type AIProvider from "./AIProvider";

 import type {
   AIRequest,
   AIResponse,
   AIProviderHealth,
 } from "./AIProvider";


 export default class GroqProvider
   implements AIProvider {


   readonly name =
     "Groq";


   readonly priority =
     1;


   readonly enabled =
     true;


   readonly timeout =
     30000;


   readonly requiresApiKey =
     true;


   readonly capabilities =
     [
       "chat",
       "reasoning",
       "fast",
       "memory",
     ] as const;



   private apiKey =
     "";


   private initialized =
     false;



   private model =
     "llama-3.3-70b-versatile";



   async initialize():
     Promise<void> {


     const runtimeEnv =
       globalThis as typeof globalThis & {
         __LELU_GROQ_API_KEY__?: string;
         __LELU_GROQ_MODEL__?: string;
       };


     const windowEnv =
       typeof window !== "undefined"
         ? (
             window as Window & {
               __LELU_GROQ_API_KEY__?: string;
             }
           )
         : undefined;


     const processEnv =
       typeof process !== "undefined"
         ? process.env
         : undefined;



     this.model =
       import.meta.env.VITE_GROQ_MODEL?.trim() ||
       runtimeEnv.__LELU_GROQ_MODEL__?.trim() ||
       "llama-3.3-70b-versatile";

     this.apiKey =

       import.meta.env.VITE_GROQ_API_KEY?.trim() ||

       runtimeEnv
         .__LELU_GROQ_API_KEY__
         ?.trim() ||

       windowEnv
         ?.__LELU_GROQ_API_KEY__
         ?.trim() ||

       processEnv
         ?.GROQ_API_KEY
         ?.trim() ||

       "";


     this.initialized =
       true;



     console.info(

       "[GroqProvider] Initialized",

       {

         hasKey:
           this.apiKey.length > 0,


         keyLength:
           this.apiKey.length,


         model:
           this.model,

       },

     );

   }



   /**
    * Choose the model for this request. When visual media is
    * attached, a vision-capable model is required: the configured
    * model is honored if it already supports vision, otherwise the
    * stable Groq vision preview is used. Text-only requests keep
    * the configured model exactly as before.
    */
   private selectModel(
     request: AIRequest,
   ): string {

     const requested =
       request.model?.trim() ||
       this.model;

     if (
       !request.media?.length
     ) {

       return requested;

     }

     const lower =
       requested.toLowerCase();

     if (
       lower.includes(
         "vision",
       ) ||
       lower.includes(
         "llava",
       )
     ) {

       return requested;

     }

     return "llama-3.2-11b-vision-preview";

   }



   /**
    * Build the final user message content. With media attached the
    * content becomes an OpenAI-style parts array (text + image_url
    * parts carrying the data URLs); without media it stays a plain
    * string so every existing path is byte-for-byte unchanged.
    */
   private buildUserContent(
     request: AIRequest,
   ): string | Array<Record<string, unknown>> {

     if (
       !request.media?.length
     ) {

       return request.prompt;

     }

     const parts: Array<Record<string, unknown>> = [];

     for (
       const media of request.media
     ) {

       if (
         media.kind === "image" &&
         media.dataUrl.startsWith("data:")
       ) {

         parts.push({
           type: "image_url",
           image_url: {
             url: media.dataUrl,
           },
         });

       }

     }

     parts.push({
       type: "text",
       text: request.prompt,
     });

     return parts;

   }





   async isAvailable():
     Promise<boolean> {


     return (

       this.initialized &&

       this.enabled &&

       this.requiresApiKey &&

       this.apiKey.length > 0

     );

   }





   async health():
     Promise<AIProviderHealth> {


     const available =
       await this.isAvailable();


     let lastError:
       string | undefined;


     if (!this.initialized) {

       lastError =
         "Groq provider not initialized.";

     }

     else if (!this.apiKey) {

       lastError =
         "Groq API key missing.";

     }



     return {

       available,

       initialized:
         this.initialized,

       lastChecked:
         Date.now(),

       lastError,

     };

   }





   canHandle(
     _input:
       string,
   ):
     boolean {


     return true;

   }





   async generate(

     request:
       AIRequest,

   ):
     Promise<AIResponse> {


     const started =
       Date.now();



     if (!this.initialized) {

       throw new Error(
         "Groq provider is not initialized.",
       );

     }



     if (!this.apiKey) {

       throw new Error(
         "Groq API key is missing.",
       );

     }



     const messages =

       [

         {

           role:
             "system",

           content:
`You are Lélu.

Identity:
- Your name is Lélu.
- You are the user's personal AI companion.
- The model running you is only the engine powering you.
- Never identify yourself as Llama, GPT, Groq, or any underlying model.
- If asked your name, answer:
"My name is Lélu."

Memory behavior:
- Information provided in Memory context is your memory system.
- Treat it as known information about the user.
- Use it naturally when relevant.
- Do not invent memories that are not provided.

Conversation behavior:
- Maintain continuity with the user.
- Personalize responses using known information.
- Be helpful, calm, creative, and engineering-focused.
- You are not a generic assistant. You are Lélu.`,

         },



         ...(request.context
           ? [

               {

                 role:
                   "system",

                 content:
`Memory context:

${request.context}`,

               },

             ]

           : []),



         ...(request.messages ?? []),



         {

           role:
             "user",

           content:
             this.buildUserContent(
               request,
             ),

         },

       ];



     const payload = {

       model:
         this.selectModel(
           request,
         ),

       messages,

       temperature:
         request.temperature ??
         0.7,

       ...(request.maxTokens
         ? { max_tokens: request.maxTokens }
         : {}),

       ...(request.stop?.length
         ? { stop: request.stop }
         : {}),

     };



     console.info(

       "[GroqProvider] Sending request",

       {

         model:
           payload.model,

         hasKey:
           this.apiKey.length > 0,

         hasMemory:
           Boolean(
             request.context,
           ),

         hasMedia:
           Boolean(
             request.media?.length,
           ),

         messages:
           messages.length,

       },

     );



     let response:
       Response;



     try {

       response =
         await fetch(

           "https://api.groq.com/openai/v1/chat/completions",

           {

             method:
               "POST",


             headers:
             {

               "Content-Type":
                 "application/json",

               Accept:
                 "application/json",

               Authorization:
                 `Bearer ${this.apiKey}`,

             },


             body:
               JSON.stringify(
                 payload,
               ),


             signal:
               AbortSignal.timeout(
                 this.timeout,
               ),

           },

         );

     }

     catch (error) {

       const message =
         error instanceof Error
           ? error.message
           : String(error);



       console.error(

         "[GroqProvider] Network request failed",

         {

           message,

         },

       );



       throw new Error(

         `Groq network error: ${message}`,

       );

     }



     const raw =
       await response.text();



     let data:
       any = null;



     if (
       raw.trim()
     ) {

       try {

         data =
           JSON.parse(raw);

       }

       catch {

         data =
           null;

       }

     }



     if (
       !response.ok
     ) {

       const apiMessage =

         data?.error?.message ||

         data?.message ||

         raw ||

         `HTTP ${response.status}`;



       console.error(

         "[GroqProvider] API request failed",

         {

           status:
             response.status,

           statusText:
             response.statusText,

           message:
             apiMessage,

           model:
             this.model,

         },

       );



       throw new Error(

         `Groq failed ${response.status}: ${apiMessage}`,

       );

     }



     const content =

       data?.choices?.[0]
         ?.message
         ?.content ??
       "";



     if (

       typeof content !==
         "string" ||

       !content.trim()

     ) {

       console.error(

         "[GroqProvider] Groq returned no usable content",

         {

           model:
             this.model,

           response:
             data,

         },

       );



       throw new Error(

         "Groq returned no usable content.",

       );

     }



     const processingTime =
       Date.now() -
       started;



     console.info(

       "[GroqProvider] Request succeeded",

       {

         model:
           this.model,

         processingTime,

         responseLength:
           content.length,

       },

     );



     return {

       text:
         content.trim(),

       provider:
         this.name,

       model:
         payload.model,

       processingTime,

       metadata: {
         usage: data?.usage,
         finishReason:
           data?.choices?.[0]?.finish_reason,
       },

     };

   }





   async shutdown():
     Promise<void> {


     this.initialized =
       false;


     this.apiKey =
       "";


     console.info(
       "[GroqProvider] Shutdown",
     );

   }

 }