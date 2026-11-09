import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { pluginView, type Plugin } from '../tabs/plugin';
import { ProvideViewScope, createViewScope, type ViewScope } from '../view-header/view-scope';
import { BlankPage } from './PlaceholderPage';
import { pluginWidgets, type PluginContext } from './registry';

/** Plugin identity within a tab: a new instance (Plugin.init) when it changes. */
export const pluginInstanceKey = (plugin: Plugin) => `${plugin.kind}:${plugin.type}:${plugin.id}`;

/**
 * Plugin.init() / dispose(): the blocs of a view plugin (PageAccessLevelBloc, ViewPluginNotifier),
 * created per plugin instance and running while it is shown in a tab.
 */
export function usePluginScope(plugin: Plugin, updateTabs: boolean): ViewScope | null {
  const key = pluginInstanceKey(plugin);
  const view = pluginView(plugin);
  // Creation has no side effects (StrictMode may run it twice); start() runs in the effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scope = useMemo(() => (view ? createViewScope(view, updateTabs) : null), [key]);
  useEffect(() => scope?.start(), [scope]);
  return scope;
}

/**
 * FadingIndexedStack (home_stack.dart): when the plugin TYPE changes inside a tab the content
 * fades in over 250 ms; swapping plugins of the same type does not fade.
 */
function FadingStack({ typeKey, children }: { typeKey: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(typeKey);
  useLayoutEffect(() => {
    if (previous.current === typeKey) return;
    previous.current = typeKey;
    ref.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
  }, [typeKey]);
  return (
    <div ref={ref} style={{ height: '100%' }}>
      {children}
    </div>
  );
}

/**
 * PageStack + PageManager.stackWidget: the surface-coloured page; BlankPagePlugin renders the
 * blank page directly, every other plugin is padded by its contentPadding.
 */
export function PageStack({ plugin, scope, context }: { plugin: Plugin; scope: ViewScope | null; context: PluginContext }) {
  const builder = pluginWidgets(plugin);
  return (
    <div style={{ height: '100%', background: 'var(--cs-surface)', overflow: 'hidden' }}>
      {plugin.kind === 'blank' ? (
        <BlankPage />
      ) : (
        <FadingStack typeKey={plugin.type}>
          <ProvideViewScope scope={scope}>
            <div key={pluginInstanceKey(plugin)} style={{ height: '100%', boxSizing: 'border-box', padding: builder.contentPadding }}>
              {builder.buildWidget(context)}
            </div>
          </ProvideViewScope>
        </FadingStack>
      )}
    </div>
  );
}
