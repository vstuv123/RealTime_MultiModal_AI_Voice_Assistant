// src/hooks/useSocket.ts
import { sendAudioBytes, sendControlMessage } from '../lib/socketManager';

export const useSocket = (_url: string) => {
    // no useEffect, no wsRef, no reconnection on tab switch
    return { sendAudioBytes, sendControlMessage };
};