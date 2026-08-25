import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AddonContext, AddonEnableFunction } from '@wealthfolio/addon-sdk';
import { TaxPage } from './pages/tax-page';

// The host owns a single React root per addon and mounts the route `component`
// itself, with no access to the addon context. Capture it at enable time so the
// route wrapper can hand it down. (Do NOT call createRoot yourself.)
let addonCtx: AddonContext | undefined;

const AddonRoute = () => (
  <QueryClientProvider client={addonCtx!.api.query.getClient() as QueryClient}>
    <TaxPage ctx={addonCtx!} />
  </QueryClientProvider>
);

const enable: AddonEnableFunction = (ctx) => {
  addonCtx = ctx;

  ctx.router.add({
    id: 'wealthfolio-skatt',
    path: '/addons/wealthfolio-skatt',
    component: AddonRoute,
  });

  ctx.onDisable(() => {
    addonCtx = undefined;
  });
};

export default enable;
