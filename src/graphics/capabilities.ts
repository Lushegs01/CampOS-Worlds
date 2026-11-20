/** CPU-only snapshot from a real application renderer; never create a hidden GPU probe. */
let capabilities: { gpu: string; maxTexture: number } | null = null;
export function rememberGraphicsCapabilities(value: { gpu: string; maxTexture: number }) { capabilities = value; }
export function graphicsCapabilities() { return capabilities; }
