import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { mergeConfigs, loadPluginConfig } from "./plugin-config";
import type { OhMyOpenCodeConfig } from "./config";
import { clearConfigLoadErrors, getConfigLoadErrors } from "./shared/config-errors";

const ORIGINAL_OPENCODE_CONFIG_DIR = process.env.OPENCODE_CONFIG_DIR;

function writeJson(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

describe("mergeConfigs", () => {
  describe("categories merging", () => {
    // given base config has categories, override has different categories
    // when merging configs
    // then should deep merge categories, not override completely

    it("should deep merge categories from base and override", () => {
      const base = {
        categories: {
          general: {
            model: "openai/gpt-5.2",
            temperature: 0.5,
          },
          quick: {
            model: "anthropic/claude-haiku-4-5",
          },
        },
      } as OhMyOpenCodeConfig;

      const override = {
        categories: {
          general: {
            temperature: 0.3,
          },
          visual: {
            model: "google/gemini-3-pro",
          },
        },
      } as unknown as OhMyOpenCodeConfig;

      const result = mergeConfigs(base, override);

      // then general.model should be preserved from base
      expect(result.categories?.general?.model).toBe("openai/gpt-5.2");
      // then general.temperature should be overridden
      expect(result.categories?.general?.temperature).toBe(0.3);
      // then quick should be preserved from base
      expect(result.categories?.quick?.model).toBe("anthropic/claude-haiku-4-5");
      // then visual should be added from override
      expect(result.categories?.visual?.model).toBe("google/gemini-3-pro");
    });

    it("should preserve base categories when override has no categories", () => {
      const base: OhMyOpenCodeConfig = {
        categories: {
          general: {
            model: "openai/gpt-5.2",
          },
        },
      };

      const override: OhMyOpenCodeConfig = {};

      const result = mergeConfigs(base, override);

      expect(result.categories?.general?.model).toBe("openai/gpt-5.2");
    });

    it("should use override categories when base has no categories", () => {
      const base: OhMyOpenCodeConfig = {};

      const override: OhMyOpenCodeConfig = {
        categories: {
          general: {
            model: "openai/gpt-5.2",
          },
        },
      };

      const result = mergeConfigs(base, override);

      expect(result.categories?.general?.model).toBe("openai/gpt-5.2");
    });
  });

  describe("existing behavior preservation", () => {
    it("should deep merge agents", () => {
      const base: OhMyOpenCodeConfig = {
        agents: {
          oracle: { model: "openai/gpt-5.2" },
        },
      };

      const override: OhMyOpenCodeConfig = {
        agents: {
          oracle: { temperature: 0.5 },
          explore: { model: "anthropic/claude-haiku-4-5" },
        },
      };

      const result = mergeConfigs(base, override);

      expect(result.agents?.oracle?.model).toBe("openai/gpt-5.2");
      expect(result.agents?.oracle?.temperature).toBe(0.5);
      expect(result.agents?.explore?.model).toBe("anthropic/claude-haiku-4-5");
    });

    it("should merge disabled arrays without duplicates", () => {
      const base: OhMyOpenCodeConfig = {
        disabled_hooks: ["comment-checker", "think-mode"],
      };

      const override: OhMyOpenCodeConfig = {
        disabled_hooks: ["think-mode", "session-recovery"],
      };

      const result = mergeConfigs(base, override);

      expect(result.disabled_hooks).toContain("comment-checker");
      expect(result.disabled_hooks).toContain("think-mode");
      expect(result.disabled_hooks).toContain("session-recovery");
      expect(result.disabled_hooks?.length).toBe(3);
    });
  });
});

describe("loadPluginConfig - profile auto-discovery", () => {
  let projectDir: string;
  let userDir: string;

  beforeEach(() => {
    clearConfigLoadErrors();
    projectDir = mkdtempSync(join(tmpdir(), "omo-project-"));
    userDir = mkdtempSync(join(tmpdir(), "omo-user-"));
    process.env.OPENCODE_CONFIG_DIR = userDir;
  });

  afterEach(() => {
    process.env.OPENCODE_CONFIG_DIR = ORIGINAL_OPENCODE_CONFIG_DIR;
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    try {
      rmSync(userDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("applies profile overrides without letting user scope override project scope", () => {
    // #given
    // user base config
    writeJson(join(userDir, "oh-my-opencode.json"), {
      disabled_hooks: ["think-mode"],
      agents: {
        oracle: { model: "openai/gpt-5.2" },
      },
    });

    // user profile wants to set temperature
    writeJson(join(userDir, "Bios_Muitle_Agent_profile.json"), {
      agents: {
        oracle: { temperature: 0.2 },
      },
    });

    // project base config overrides temperature
    writeJson(join(projectDir, ".opencode", "oh-my-opencode.json"), {
      agents: {
        oracle: { temperature: 0.9 },
      },
    });

    // project profile overrides again
    writeJson(join(projectDir, ".opencode", "Bios_Muitle_Agent_profile.json"), {
      agents: {
        oracle: { temperature: 0.1 },
      },
    });

    // #when
    const result = loadPluginConfig(projectDir, {});

    // #then
    expect(result.agents?.oracle?.model).toBe("openai/gpt-5.2");
    expect(result.agents?.oracle?.temperature).toBe(0.1);
    expect(result.disabled_hooks).toContain("think-mode");
  });

  it("uses root profile as a project-scope override (lower than .opencode profile)", () => {
    // #given
    writeJson(join(userDir, "oh-my-opencode.json"), {
      agents: { oracle: { temperature: 0.8 } },
    });

    writeJson(join(projectDir, ".opencode", "oh-my-opencode.json"), {
      agents: { oracle: { temperature: 0.9 } },
    });

    // root profile should override project base
    writeJson(join(projectDir, "Bios_Muitle_Agent_profile.json"), {
      agents: { oracle: { temperature: 0.3 } },
    });

    // #when
    const result = loadPluginConfig(projectDir, {});

    // #then
    expect(result.agents?.oracle?.temperature).toBe(0.3);

    // #given - .opencode profile should override root profile
    writeJson(join(projectDir, ".opencode", "Bios_Muitle_Agent_profile.json"), {
      agents: { oracle: { temperature: 0.1 } },
    });

    // #when
    const result2 = loadPluginConfig(projectDir, {});

    // #then
    expect(result2.agents?.oracle?.temperature).toBe(0.1);
  });

  it("records a load error for invalid profile JSON and continues", () => {
    // #given
    writeJson(join(projectDir, ".opencode", "oh-my-opencode.json"), {
      agents: { oracle: { temperature: 0.9 } },
    });

    const invalidProfilePath = join(
      projectDir,
      ".opencode",
      "Bios_Muitle_Agent_profile.json"
    );
    mkdirSync(join(projectDir, ".opencode"), { recursive: true });
    writeFileSync(invalidProfilePath, "{", "utf-8");

    // #when
    const result = loadPluginConfig(projectDir, {});

    // #then
    expect(result.agents?.oracle?.temperature).toBe(0.9);
    const errors = getConfigLoadErrors();
    expect(errors.some((e) => e.path === invalidProfilePath)).toBe(true);
  });
});
