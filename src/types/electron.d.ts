export interface ElectronAPI {
    getSettings: () => Promise<{
        savePath: string;
        imageFormat: 'png' | 'jpg';
        videoFormat: 'mp4' | 'webm';
        audioSource: 'none' | 'system' | 'mic';
        frameRate: 30 | 60 | 90;
    }>;
    getScreenSourceId: () => Promise<string>;
    captureRegion: (
        rect: { x: number, y: number, width: number, height: number },
        mode: string,
        mousePos: { x: number, y: number }
    ) => Promise<string>;

    // rect 增加 scaleFactor
    startRecordingWorker: (rect: { x: number, y: number, width: number, height: number, scaleFactor: number }) => Promise<boolean>;
    stopRecordingWorker: () => Promise<void>;
    recordingFinished: (blob: ArrayBuffer) => Promise<string>;

    onStartRecording: (callback: (event: any, rect: any, settings: any) => void) => () => void;
    onStopRecording: (callback: () => void) => () => void;

    closeSelector: () => Promise<void>;
    log: (msg: string) => void;
    setIgnoreMouseEvents: (ignore: boolean, options?: { forward: boolean }) => void;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

export { };
