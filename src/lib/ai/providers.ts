export type AiCapability = 'text' | 'vision' | 'imageEdit'

export type AiTransport = 'openai' | 'azure' | 'anthropic' | 'gemini' | 'ollama'

export interface AiModelOption {
  id: string
  label: string
  caps: AiCapability[]
  note?: string
}

export interface AiProvider {
  id: string
  name: string
  blurb: string
  transport: AiTransport
  /** Base URL. Azure uses a resource/deployment template, see `azurePath`. */
  baseUrl: string
  /** Local providers need no key and never leave the machine. */
  local?: boolean
  keyless?: boolean
  keyUrl?: string
  keyHint?: string
  models: AiModelOption[]
  defaultModel: string
  /** Extra headers some gateways want (OpenRouter attribution, etc). */
  extraHeaders?: Record<string, string>
  /** Some OpenAI-compatible servers reject response_format json_object. */
  supportsJsonMode?: boolean
  /** How masked/image editing is expressed for this provider. */
  imageEditStyle?: 'openai-edits' | 'together-generations'
  notes?: string
}

export const PROVIDERS: AiProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    blurb: 'Best all-round: strong vision for captions, and gpt-image-1 can actually erase objects with a mask.',
    transport: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-…',
    defaultModel: 'gpt-4.1-mini',
    supportsJsonMode: true,
    models: [
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', caps: ['text', 'vision'], note: 'cheap + fast' },
      { id: 'gpt-4.1', label: 'GPT-4.1', caps: ['text', 'vision'] },
      { id: 'gpt-4o', label: 'GPT-4o', caps: ['text', 'vision'] },
      { id: 'gpt-image-1', label: 'gpt-image-1', caps: ['imageEdit'], note: 'masked inpainting' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    blurb: 'Claude is excellent at describing scenes and judging which frame in a burst is better.',
    transport: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'sk-ant-…',
    defaultModel: 'claude-sonnet-4-5',
    models: [
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', caps: ['text', 'vision'] },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', caps: ['text', 'vision'], note: 'cheapest' },
      { id: 'claude-opus-4-1', label: 'Claude Opus 4.1', caps: ['text', 'vision'] },
    ],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    blurb: 'Generous free tier, strong images, and gemini-2.5-flash-image can edit the picture itself.',
    transport: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'AIza…',
    defaultModel: 'gemini-2.5-flash',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', caps: ['text', 'vision'], note: 'free tier' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', caps: ['text', 'vision'] },
      { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image', caps: ['imageEdit'], note: 'image out' },
    ],
  },
  {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    blurb: 'Same models as OpenAI inside your own tenant. Set the resource URL and deployment name.',
    transport: 'azure',
    baseUrl: 'https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT',
    keyUrl: 'https://portal.azure.com',
    keyHint: 'azure key',
    defaultModel: 'gpt-4.1-mini',
    supportsJsonMode: true,
    notes: 'Model field is the deployment name. api-version 2024-10-21 is appended automatically.',
    models: [
      { id: 'gpt-4.1-mini', label: 'deployment: gpt-4.1-mini', caps: ['text', 'vision'] },
      { id: 'gpt-4.1', label: 'deployment: gpt-4.1', caps: ['text', 'vision'] },
      { id: 'gpt-image-1', label: 'deployment: gpt-image-1', caps: ['imageEdit'] },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    blurb: 'One key, hundreds of models from every vendor. Great for trying models without new accounts.',
    transport: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys',
    keyHint: 'sk-or-…',
    defaultModel: 'google/gemini-2.5-flash',
    supportsJsonMode: true,
    extraHeaders: { 'HTTP-Referer': 'https://insta-buddy.app', 'X-Title': 'Insta Buddy' },
    models: [
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', caps: ['text', 'vision'] },
      { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5', caps: ['text', 'vision'] },
      { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini', caps: ['text', 'vision'] },
      { id: 'meta-llama/llama-4-maverick', label: 'Llama 4 Maverick', caps: ['text', 'vision'] },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    blurb: 'Absurdly fast inference. Good for alt text on a whole dump without waiting.',
    transport: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    keyHint: 'gsk_…',
    defaultModel: 'llama-3.3-70b-versatile',
    supportsJsonMode: true,
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', caps: ['text'] },
      { id: 'llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout 17B', caps: ['text', 'vision'] },
      { id: 'qwen/qwen3-32b', label: 'Qwen3 32B', caps: ['text'] },
    ],
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    blurb: 'European provider, OpenAI-compatible, Pixtral handles the vision side.',
    transport: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    keyUrl: 'https://console.mistral.ai/api-keys',
    keyHint: 'API key',
    defaultModel: 'mistral-small-latest',
    supportsJsonMode: true,
    models: [
      { id: 'mistral-small-latest', label: 'Mistral Small', caps: ['text', 'vision'] },
      { id: 'mistral-large-latest', label: 'Mistral Large', caps: ['text'] },
      { id: 'pixtral-large-latest', label: 'Pixtral Large', caps: ['text', 'vision'] },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    blurb: 'Very cheap text reasoning — handy for caption variants and culling notes, no vision.',
    transport: 'openai',
    baseUrl: 'https://api.deepseek.com',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyHint: 'sk-…',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat', caps: ['text'] },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', caps: ['text'], note: 'slower, thinks' },
    ],
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    blurb: 'Grok with vision. Reads scenes well and is quick to answer.',
    transport: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    keyUrl: 'https://console.x.ai',
    keyHint: 'xai-…',
    defaultModel: 'grok-4-fast',
    supportsJsonMode: true,
    models: [
      { id: 'grok-4-fast', label: 'Grok 4 Fast', caps: ['text', 'vision'] },
      { id: 'grok-2-vision-1212', label: 'Grok 2 Vision', caps: ['text', 'vision'] },
    ],
  },
  {
    id: 'together',
    name: 'Together AI',
    blurb: 'Open models plus FLUX Kontext for real image edits — a good OpenAI alternative for erasing.',
    transport: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    keyUrl: 'https://api.together.ai/settings/api-keys',
    keyHint: 'together key',
    defaultModel: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
    supportsJsonMode: true,
    imageEditStyle: 'together-generations',
    models: [
      { id: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', label: 'Llama 4 Maverick', caps: ['text', 'vision'] },
      { id: 'Qwen/Qwen2.5-VL-72B-Instruct', label: 'Qwen2.5 VL 72B', caps: ['text', 'vision'] },
      { id: 'black-forest-labs/FLUX.1-kontext-pro', label: 'FLUX.1 Kontext Pro', caps: ['imageEdit'], note: 'image edits' },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    blurb: 'Runs on your own machine. Nothing leaves the computer — pair it with the on-device engine for a fully offline app.',
    transport: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    local: true,
    keyless: true,
    defaultModel: 'qwen2.5vl:7b',
    models: [
      { id: 'qwen2.5vl:7b', label: 'Qwen2.5 VL 7B', caps: ['text', 'vision'] },
      { id: 'llama3.2-vision:11b', label: 'Llama 3.2 Vision 11B', caps: ['text', 'vision'] },
      { id: 'llava:7b', label: 'LLaVA 7B', caps: ['text', 'vision'] },
    ],
    notes: 'Pull a model first, e.g. ollama pull qwen2.5vl:7b',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (local)',
    blurb: 'Local OpenAI-compatible server. Start the server in LM Studio and use whatever model you have loaded.',
    transport: 'openai',
    baseUrl: 'http://127.0.0.1:1234/v1',
    local: true,
    keyless: true,
    defaultModel: 'local-model',
    models: [
      { id: 'local-model', label: 'Whatever is loaded', caps: ['text', 'vision'], note: 'LM Studio ignores the id' },
    ],
    notes: 'Enable "Serve on Local Network" (or at least the local server) in LM Studio.',
  },
]

export function providerById(id: string) {
  return PROVIDERS.find((p) => p.id === id)
}

export function modelById(provider: AiProvider, modelId: string) {
  return provider.models.find((m) => m.id === modelId)
}

export function providerCaps(provider: AiProvider): AiCapability[] {
  const set = new Set<AiCapability>()
  for (const m of provider.models) m.caps.forEach((c) => set.add(c))
  return [...set]
}

export function modelCaps(provider: AiProvider, modelId: string): AiCapability[] {
  const model = modelById(provider, modelId)
  if (model) return model.caps
  // custom model ids: inherit the provider's safest union
  return providerCaps(provider)
}

export function canDo(providerId: string, modelId: string, cap: AiCapability) {
  const provider = providerById(providerId)
  if (!provider) return false
  return modelCaps(provider, modelId).includes(cap)
}

export const PROVIDER_COUNT = PROVIDERS.length
