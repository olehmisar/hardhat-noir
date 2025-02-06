import { HardhatConfig } from "hardhat/types";
import { z } from "zod";
import { getFileHash, getHashOfNoirWorkspace, sha256 } from "./hash";

const CACHE_FILENAME = "noir-files-cache.json";

export class NoirCache {
  constructor(
    private cache: CacheSchema,
    private config: HardhatConfig,
  ) {}

  static async fromConfig(config: HardhatConfig) {
    const fs = await import("fs");
    const path = await import("path");

    const cacheFile = path.join(config.paths.cache, CACHE_FILENAME); // to store the cache
    if (!fs.existsSync(cacheFile)) {
      return await this.empty(config);
    }
    let cacheJson: CacheSchema;
    try {
      cacheJson = CacheSchema.parse(
        JSON.parse(await fs.promises.readFile(cacheFile, "utf-8")),
      );
    } catch (error) {
      return await this.empty(config);
    }

    const toolingVersions = await getToolingHash(config);
    if (cacheJson.toolingVersions !== toolingVersions) {
      return await this.empty(config);
    }
    return new NoirCache(cacheJson, config);
  }

  static async empty(config: HardhatConfig) {
    return new NoirCache(
      {
        toolingVersions: await getToolingHash(config),
        sourceFiles: "",
        jsonFiles: {},
      },
      config,
    );
  }

  async haveSourceFilesChanged() {
    const currentHash = await getHashOfNoirWorkspace(this.noirDir);
    return this.cache.sourceFiles !== currentHash;
  }

  async saveSourceFilesHash() {
    const currentHash = await getHashOfNoirWorkspace(this.noirDir);
    this.cache.sourceFiles = currentHash;
    await this.#save();
  }

  async hasJsonFileChanged(file: string) {
    const jsonHash = await getFileHash(file);
    return jsonHash !== this.cache.jsonFiles[file];
  }

  async saveJsonFileHash(file: string) {
    const jsonHash = await getFileHash(file);
    this.cache.jsonFiles[file] = jsonHash;
    await this.#save();
  }

  private get noirDir() {
    return this.config.paths.noir;
  }

  async #save() {
    const fs = await import("fs");
    const path = await import("path");
    const cacheDir = this.config.paths.cache;
    fs.mkdirSync(cacheDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(cacheDir, CACHE_FILENAME),
      JSON.stringify(this.cache),
    );
  }
}

async function getToolingHash(config: HardhatConfig) {
  return await sha256(JSON.stringify(config.noir));
}

// TODO: i could not make it work. But should be using io-ts because hardhat already uses it and zod is a very heavy lib
// type NoirCache = t.TypeOf<typeof NoirCache>;
// const NoirCache = t.type({
//   sourceFiles: t.union([t.string, t.null]),
//   jsonFiles: t.record(t.string, t.string),
// });
type CacheSchema = z.infer<typeof CacheSchema>;
const CacheSchema = z.object({
  toolingVersions: z.string(),
  sourceFiles: z.string(),
  jsonFiles: z.record(z.string(), z.string()),
});
