/** The cloud services Settings → Backups → Cloud backup lists, in this order. */
export type CloudProvider = 'google' | 'onedrive';
export const CLOUD_PROVIDERS: readonly CloudProvider[] = ['google', 'onedrive'];

/**
 * What each service offers on this PC: a Connect button when this build can sign in to it, otherwise a calm
 * "coming soon" note (a build without that service's client ID, such as OneDrive for now) and never a dead button.
 */
export function cloudChoices(configured: Partial<Record<CloudProvider, boolean>>): { provider: CloudProvider; state: 'connect' | 'soon' }[] {
  return CLOUD_PROVIDERS.map((provider) => ({ provider, state: configured[provider] === true ? 'connect' : 'soon' }));
}
