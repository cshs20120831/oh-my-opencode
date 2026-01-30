import * as fs from "fs";
import * as path from "path";
import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig } from "./config";
import {
  log,
  deepMerge,
  getOpenCodeConfigDir,
  addConfigLoadError,
  parseJsonc,
  detectConfigFile,
  migrateConfigFile,
} from "./shared";

// NOTE: This repository may be forked/renamed.
// Keep the profile basename aligned with the intended plugin identity.
const PLUGIN_CONFIG_BASENAME = "oh-my-opencode";
const PLUGIN_PROFILE_BASENAME = "Bios_Muitle_Agent_profile";

function resolveDetectedConfigPath(basePath: string): string {
  const detected = detectConfigFile(basePath);
  return detected.format !== "none" ? detected.path : basePath + ".json";
}

function loadProfileLayeredConfig(
  directory: string,
  ctx: unknown
): {
  userProfilePath: string;
  rootProfilePath: string;
  projectProfilePath: string;
  userProfile: OhMyOpenCodeConfig | null;
  rootProfile: OhMyOpenCodeConfig | null;
  projectProfile: OhMyOpenCodeConfig | null;
  mergedUser: OhMyOpenCodeConfig;
  mergedProject: OhMyOpenCodeConfig;
} {
  const configDir = getOpenCodeConfigDir({ binary: "opencode" });

  const userProfileBasePath = path.join(configDir, PLUGIN_PROFILE_BASENAME);
  const rootProfileBasePath = path.join(directory, PLUGIN_PROFILE_BASENAME);
  const projectProfileBasePath = path.join(
    directory,
    ".opencode",
    PLUGIN_PROFILE_BASENAME
  );

  const userProfilePath = resolveDetectedConfigPath(userProfileBasePath);
  const rootProfilePath = resolveDetectedConfigPath(rootProfileBasePath);
  const projectProfilePath = resolveDetectedConfigPath(projectProfileBasePath);

  const userProfile = loadConfigFromPath(userProfilePath, ctx);
  const rootProfile = loadConfigFromPath(rootProfilePath, ctx);
  const projectProfile = loadConfigFromPath(projectProfilePath, ctx);

  // Scope-aware layering: user scope should never override project scope.
  // - user scope: userProfile
  // - project scope: rootProfile (project root) < projectProfile (.opencode)
  const mergedUser: OhMyOpenCodeConfig = userProfile ?? {};
  let mergedProject: OhMyOpenCodeConfig = rootProfile ?? {};
  if (projectProfile) {
    mergedProject = mergeConfigs(mergedProject, projectProfile);
  }

  return {
    userProfilePath,
    rootProfilePath,
    projectProfilePath,
    userProfile,
    rootProfile,
    projectProfile,
    mergedUser,
    mergedProject,
  };
}

export function loadConfigFromPath(
  configPath: string,
  ctx: unknown
): OhMyOpenCodeConfig | null {
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, "utf-8");
      const rawConfig = parseJsonc<Record<string, unknown>>(content);

      migrateConfigFile(configPath, rawConfig);

      const result = OhMyOpenCodeConfigSchema.safeParse(rawConfig);

      if (!result.success) {
        const errorMsg = result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(", ");
        log(`Config validation error in ${configPath}:`, result.error.issues);
        addConfigLoadError({
          path: configPath,
          error: `Validation error: ${errorMsg}`,
        });
        return null;
      }

      log(`Config loaded from ${configPath}`, { agents: result.data.agents });
      return result.data;
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log(`Error loading config from ${configPath}:`, err);
    addConfigLoadError({ path: configPath, error: errorMsg });
  }
  return null;
}

export function mergeConfigs(
  base: OhMyOpenCodeConfig,
  override: OhMyOpenCodeConfig
): OhMyOpenCodeConfig {
  return {
    ...base,
    ...override,
    agents: deepMerge(base.agents, override.agents),
    categories: deepMerge(base.categories, override.categories),
    disabled_agents: [
      ...new Set([
        ...(base.disabled_agents ?? []),
        ...(override.disabled_agents ?? []),
      ]),
    ],
    disabled_mcps: [
      ...new Set([
        ...(base.disabled_mcps ?? []),
        ...(override.disabled_mcps ?? []),
      ]),
    ],
    disabled_hooks: [
      ...new Set([
        ...(base.disabled_hooks ?? []),
        ...(override.disabled_hooks ?? []),
      ]),
    ],
    disabled_commands: [
      ...new Set([
        ...(base.disabled_commands ?? []),
        ...(override.disabled_commands ?? []),
      ]),
    ],
    disabled_skills: [
      ...new Set([
        ...(base.disabled_skills ?? []),
        ...(override.disabled_skills ?? []),
      ]),
    ],
    claude_code: deepMerge(base.claude_code, override.claude_code),
  };
}

export function loadPluginConfig(
  directory: string,
  ctx: unknown
): OhMyOpenCodeConfig {
  // User-level config path - prefer .jsonc over .json
  const configDir = getOpenCodeConfigDir({ binary: "opencode" });
  const userBasePath = path.join(configDir, PLUGIN_CONFIG_BASENAME);
  const userConfigPath = resolveDetectedConfigPath(userBasePath);

  // Project-level config path - prefer .jsonc over .json
  const projectBasePath = path.join(
    directory,
    ".opencode",
    PLUGIN_CONFIG_BASENAME
  );
  const projectConfigPath = resolveDetectedConfigPath(projectBasePath);

  const profile = loadProfileLayeredConfig(directory, ctx);

  // Scope-aware layering:
  // - user scope: user config < user profile
  // - project scope: project config < root profile < .opencode profile
  // - final: user scope < project scope
  const userBase = loadConfigFromPath(userConfigPath, ctx) ?? {};
  const mergedUser = mergeConfigs(userBase, profile.mergedUser);

  const projectBase = loadConfigFromPath(projectConfigPath, ctx) ?? {};
  const mergedProject = mergeConfigs(projectBase, profile.mergedProject);

  const config = mergeConfigs(mergedUser, mergedProject);

  log("Final merged config", {
    agents: config.agents,
    disabled_agents: config.disabled_agents,
    disabled_mcps: config.disabled_mcps,
    disabled_hooks: config.disabled_hooks,
    claude_code: config.claude_code,
    profile_paths: {
      user: profile.userProfile ? profile.userProfilePath : null,
      root: profile.rootProfile ? profile.rootProfilePath : null,
      project: profile.projectProfile ? profile.projectProfilePath : null,
    },
  });
  return config;
}
