import type { Provider } from '@/lib/core/types';
import { runtimeCapabilities, serverEnv } from '@/lib/env';
import { LocalProvider } from '@/lib/providers/local';
import { OpenRouterProvider } from '@/lib/providers/openrouter';

/**
 * Provider resolution.
 *
 * Every model in the catalog is reachable through one gateway, so resolution is
 * a single decision: live traffic or the deterministic simulator. Registering a
 * genuinely separate transport (a direct vendor SDK, a self-hosted vLLM
 * endpoint, an internal proxy) means implementing `Provider` and calling
 * `registerProvider`; nothing downstream needs to change.
 */

const customProviders = new Map<string, Provider>();

/**
 * Registers a transport under a key that model ids can opt into via prefix.
 * A model id of `selfhosted:llama-3` resolves to the provider registered as
 * `selfhosted`.
 */
export function registerProvider(key: string, provider: Provider): void {
  customProviders.set(key, provider);
}

export function unregisterProvider(key: string): void {
  customProviders.delete(key);
}

let cachedDefault: Provider | null = null;

/** Resets memoised providers. Used by tests that flip environment variables. */
export function resetProviderCache(): void {
  cachedDefault = null;
  customProviders.clear();
}

/**
 * Returns the transport that should serve a given model id.
 *
 * Falls back to the local simulator whenever live models are not configured, so
 * a fresh clone is fully functional rather than erroring on first run.
 */
export function resolveProvider(modelId: string): Provider {
  const prefixMatch = modelId.includes(':') ? modelId.split(':')[0]! : null;
  if (prefixMatch) {
    const custom = customProviders.get(prefixMatch);
    if (custom) return custom;
  }

  if (cachedDefault) return cachedDefault;

  const capabilities = runtimeCapabilities(serverEnv());
  cachedDefault = capabilities.liveModels
    ? new OpenRouterProvider()
    : new LocalProvider();
  return cachedDefault;
}

/** True when model calls hit a real vendor rather than the simulator. */
export function usingLiveModels(): boolean {
  return runtimeCapabilities(serverEnv()).liveModels;
}
