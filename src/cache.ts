import { HardhatConfig } from "hardhat/types";
import { z } from "zod";
import { getFileHash, getHashOfNoirWorkspace, sha256 } from "./hash";
import { getTarget } from "./Noir";

const CACHE_FILENAME = ".noir-hardhat-cache";

export class NoirCache {
  constructor(
    private cache: CacheSchema,
    private noirDir: string,
  ) {}

  static async fromConfig(config: HardhatConfig) {
    const fs = await import("fs");
    const path = await import("path");
    const targetDir = await getTarget(config.paths.noir);

    const cacheFile = path.join(targetDir, CACHE_FILENAME); // to store the cache
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
    return new NoirCache(cacheJson, config.paths.noir);
  }

  static async empty(config: HardhatConfig) {
    return new NoirCache(
      {
        toolingVersions: await getToolingHash(config),
        sourceFiles: "",
        jsonFiles: {},
      },
      config.paths.noir,
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

  async #save() {
    const fs = await import("fs");
    const path = await import("path");
    const targetDir = await getTarget(this.noirDir);
    fs.mkdirSync(targetDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(targetDir, CACHE_FILENAME),
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
