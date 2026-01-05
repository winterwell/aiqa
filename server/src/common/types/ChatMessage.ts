export interface ChatMessagePart {
    // What is the format for these?
}

export default interface ChatMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | ChatMessagePart[];
}