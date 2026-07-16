export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMProvider {
  chat(messages: LLMMessage[]): Promise<string>;
}

export class OpenAIProvider implements LLMProvider {
  private apiKey: string;
  private model: string;

  constructor(model: string = 'gpt-4o') {
    this.apiKey = process.env.ALP_OPENAI_KEY || '';
    if (!this.apiKey) {
      throw new Error('ALP_OPENAI_KEY environment variable is missing.');
    }
    this.model = model;
  }

  async chat(messages: LLMMessage[]): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as any;
    return data.choices[0].message.content;
  }
}

export class AnthropicProvider implements LLMProvider {
  private apiKey: string;
  private model: string;

  constructor(model: string = 'claude-3-5-sonnet-20240620') {
    this.apiKey = process.env.ALP_ANTHROPIC_KEY || '';
    if (!this.apiKey) {
      throw new Error('ALP_ANTHROPIC_KEY environment variable is missing.');
    }
    this.model = model;
  }

  async chat(messages: LLMMessage[]): Promise<string> {
    const systemMessage = messages.find(m => m.role === 'system');
    const userMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        system: systemMessage ? systemMessage.content : undefined,
        messages: userMessages,
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as any;
    return data.content[0].text;
  }
}

export class OllamaProvider implements LLMProvider {
  private url: string;
  private model: string;

  constructor(model: string = 'llama3') {
    this.url = process.env.ALP_OLLAMA_URL || 'http://localhost:11434';
    this.model = model;
  }

  async chat(messages: LLMMessage[]): Promise<string> {
    const response = await fetch(`${this.url}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as any;
    return data.message.content;
  }
}

export function createProvider(providerName: string, modelName?: string): LLMProvider {
  switch (providerName.toLowerCase()) {
    case 'openai':
      return new OpenAIProvider(modelName);
    case 'anthropic':
      return new AnthropicProvider(modelName);
    case 'local':
    case 'ollama':
      return new OllamaProvider(modelName);
    default:
      throw new Error(`Unsupported LLM provider: ${providerName}`);
  }
}
