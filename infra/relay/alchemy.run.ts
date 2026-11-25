// @effect-diagnostics anyUnknownInErrorContext:off layerMergeAllWithDependencies:off - Alchemy provider helpers expose framework-owned any requirements.
import * as Alchemy from "alchemy";
import * as Axiom from "@alchemy.run/axiom";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Drizzle from "@alchemy.run/drizzle";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Planetscale from "@alchemy.run/planetscale";

import { PublishClientConfig } from "./src/clientConfig.ts";
import * as RelayDb from "./src/db.ts";
import { MobileSourceMapsUploadCredentials, RelayObservability } from "./src/observability.ts";
import { isPreviewStage } from "./src/previewStages.ts";
import { PreviewTunnelSweep, PreviewTunnelSweepProvider } from "./src/previewTunnelSweep.ts";
import { ManagedEndpointZone, RelayApiZone, RelayDeploymentConfig } from "./src/zone.ts";
import * as RelayWorker from "./src/worker.ts";

export default Alchemy.Stack(
  "T3CodeRelay",
  {
    providers: Layer.mergeAll(
      Axiom.providers(),
      Cloudflare.providers(),
      Drizzle.providers(),
      Planetscale.providers(),
      PreviewTunnelSweepProvider(),
    ),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const db = yield* RelayDb.PlanetscaleDatabase;
    const hyperdrive = yield* RelayDb.RelayHyperdrive;
    const managedEndpointZone = yield* ManagedEndpointZone.pipe(Effect.orDie);
    const relayApiZone = yield* RelayApiZone.pipe(Effect.orDie);
    const observability = yield* RelayObservability;
    const mobileSourceMapsUploadCredentials = yield* MobileSourceMapsUploadCredentials;
    const api = yield* RelayWorker.Api;
    yield* PublishClientConfig({ url: api.url });
    if (isPreviewStage(stage)) {
      const { managedEndpointZoneName } = yield* RelayDeploymentConfig;
      yield* PreviewTunnelSweep("PreviewTunnelSweep", {
        stage,
        tunnelZoneName: managedEndpointZoneName,
        workerName: api.workerName,
      });
    }
    return {
      databaseName: db.database.name,
      databaseBranchName: db.branch?.name ?? "main",
      hyperdriveName: hyperdrive.name,
      workerName: api.workerName,
      url: api.url,
      relayApiZoneId: relayApiZone.zoneId,
      managedEndpointZoneId: managedEndpointZone.zoneId,
      mobileLogsDataset: observability.mobileLogs.name,
      mobileMetricsDataset: observability.mobileMetrics.name,
      mobileSourceMapsBucket: observability.mobileSourceMaps.bucketName,
      // The MOBILE_SOURCEMAPS_R2 secret for GitHub Actions and EAS Build.
      mobileSourceMapsUploadCredentials,
    };
  }).pipe(Effect.provide(RelayWorker.layer)),
);
