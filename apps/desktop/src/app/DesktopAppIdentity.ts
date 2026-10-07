import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as DesktopAssets from "./DesktopAssets.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopUserData from "./DesktopUserData.ts";
import { aboutMetadata } from "./aboutMetadata.ts";

const AppPackageMetadata = Schema.Struct({
  t3codeCommitHash: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  t3codeBuiltAtUTC: Schema.optional(Schema.String),
  t3codeCopyright: Schema.optional(Schema.String),
});
const decodeAppPackageMetadata = Schema.decodeEffect(Schema.fromJsonString(AppPackageMetadata));

export class DesktopAppIdentity extends Context.Service<
  DesktopAppIdentity,
  {
    readonly resolveUserDataPath: Effect.Effect<
      string,
      DesktopUserData.DesktopUserDataInitializationError
    >;
    readonly configure: Effect.Effect<void>;
  }
>()("@t3tools/desktop/app/DesktopAppIdentity") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const assets = yield* DesktopAssets.DesktopAssets;
  const electronApp = yield* ElectronApp.ElectronApp;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const userDataContext = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const userDataPath = DesktopUserData.resolveUserDataPath(environment).pipe(
    Effect.provide(userDataContext),
  );

  const configure = Effect.gen(function* () {
    const embedded = environment.isPackaged
      ? yield* fileSystem
          .readFileString(environment.path.join(environment.appRoot, "package.json"))
          .pipe(
            Effect.flatMap(decodeAppPackageMetadata),
            Effect.orElseSucceed(() => undefined),
          )
      : undefined;
    const iconPaths = yield* assets.iconPaths;
    yield* electronApp.setName(environment.displayName);
    yield* electronApp.setAboutPanelOptions({
      applicationName: environment.displayName,
      ...aboutMetadata({
        packaged: environment.isPackaged,
        version: environment.appVersion,
        commitOverride: Option.getOrUndefined(environment.commitHashOverride),
        embedded,
      }),
      ...(Option.isSome(iconPaths.png) ? { iconPath: iconPaths.png.value } : {}),
    });

    if (environment.platform === "win32") {
      yield* electronApp.setAppUserModelId(environment.appUserModelId);
    }

    // Unpackaged runs only. A packaged bundle already carries its icon in
    // Info.plist, so setting the dock tile again changes nothing except to
    // overwrite a custom icon the user attached to the app themselves.
    if (environment.platform === "darwin" && !environment.isPackaged) {
      yield* Option.match(iconPaths.png, {
        onNone: () => Effect.void,
        onSome: electronApp.setDockIcon,
      });
    }
  }).pipe(Effect.withSpan("desktop.appIdentity.configure"));

  return DesktopAppIdentity.of({
    resolveUserDataPath: userDataPath,
    configure,
  });
});

export const layer = Layer.effect(DesktopAppIdentity, make);
