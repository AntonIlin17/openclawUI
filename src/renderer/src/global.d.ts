import type { OpenClawDesktopApi } from "../../shared/ipc";

declare global {
  interface Window {
    openclaw: OpenClawDesktopApi;
    SpeechRecognition?: typeof SpeechRecognition;
    webkitSpeechRecognition?: typeof SpeechRecognition;
  }
}

export {};
