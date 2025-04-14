import { DEFAULT_DEBUG_FOLDER, type Entity } from "./baseTypes";
import { FakeFs } from "./fsAll";

import {TAbstractFile, TFile, TFolder, type Vault} from "obsidian";
import { mkdirpInVault, statFix, unixTimeToStr } from "./misc";
import { listFilesInObsFolder } from "./obsFolderLister";
import type { Profiler } from "./profiler";
import {Queue} from "@fyears/tsqueue";
import flatten from "lodash/flatten";

export class FakeFsLocal extends FakeFs {
  vault: Vault;
  syncConfigDir: boolean;
  syncBookmarks: boolean;
  configDir: string;
  pluginID: string;
  profiler: Profiler | undefined;
  deleteToWhere: "obsidian" | "system";
  kind: "local";
  constructor(
    vault: Vault,
    syncConfigDir: boolean,
    syncBookmarks: boolean,
    configDir: string,
    pluginID: string,
    profiler: Profiler | undefined,
    deleteToWhere: "obsidian" | "system"
  ) {
    super();

    this.vault = vault;
    this.syncConfigDir = syncConfigDir;
    this.syncBookmarks = syncBookmarks;
    this.configDir = configDir;
    this.pluginID = pluginID;
    this.profiler = profiler;
    this.deleteToWhere = deleteToWhere;
    this.kind = "local";
  }

  async walk(): Promise<Entity[]> {
    this.profiler?.addIndent();
    this.profiler?.insert("enter walk for local");
    const local: Entity[] = [];

    for (let e of await this.getVaultEntitiesWithDotfiles()) {
      local.push(e)
    }

    this.profiler?.insert("finish getting walk for local");

    this.profiler?.insert("finish transforming walk for local");

    if (this.syncConfigDir || this.syncBookmarks) {
      this.profiler?.insert("into syncConfigDir or syncBookmarks");
      const bookmarksOnly = !this.syncConfigDir;
      const syncFiles = await listFilesInObsFolder(
        this.configDir,
        this.vault,
        this.pluginID,
        bookmarksOnly
      );
      // console.debug(`syncFiles in obs: ${JSON.stringify(syncFiles, null, 2)}`);
      for (const f of syncFiles) {
        local.push(f);
      }
      this.profiler?.insert("finish syncConfigDir");
    }

    this.profiler?.insert("finish walk for local");
    this.profiler?.removeIndent();
    return local;
  }

  async getVaultEntitiesWithDotfiles(): Promise<Entity[]> {
    const q = new Queue(["/"])
    let contents: Entity[] = []

    while (q.size() > 0) {
      const path2scan = q.shift() ?? ""; // never point

      await this.vault.adapter.list(path2scan).then(async list => {
        for (let folder of list.folders) {
          if (folder == ".obsidian") {
            continue;
          }

          const path = folder + "/"
          const statRes = await this.vault.adapter.stat(path)

          if (statRes === undefined || statRes === null) {
            throw Error("something goes wrong while listing hidden folder");
          }

          const e = {
            key: path,
            keyRaw: path,
            mtimeCli: statRes.mtime,
            mtimeSvr: statRes.mtime,
            size: statRes.size, // local always unencrypted
            sizeRaw: statRes.size,
          }

          q.push(path)
          contents.push(e)
        }

        for (let file of list.files) {
          const path = file
          const statRes = await this.vault.adapter.stat(path)

          if (statRes === undefined || statRes === null) {
            throw Error("something goes wrong while listing hidden folder");
          }

          const e = {
            key: path,
            keyRaw: path,
            mtimeCli: statRes.mtime,
            mtimeSvr: statRes.mtime,
            size: statRes.size, // local always unencrypted
            sizeRaw: statRes.size,
          }

          contents.push(e)
        }
      })
    }

    return contents
  }

  async walkPartial(): Promise<Entity[]> {
    return await this.walk();
  }

  async stat(key: string): Promise<Entity> {
    const statRes = await statFix(this.vault, key);
    if (statRes === undefined || statRes === null) {
      throw Error(`${key} does not exist! cannot stat for local`);
    }
    const isFolder = statRes.type === "folder";
    return {
      key: isFolder ? `${key}/` : key, // local always unencrypted
      keyRaw: isFolder ? `${key}/` : key,
      ctimeCli: statRes.ctime,
      mtimeCli: statRes.mtime,
      mtimeSvr: statRes.mtime,
      ctimeCliFmt: unixTimeToStr(statRes.ctime),
      mtimeCliFmt: unixTimeToStr(statRes.mtime),
      mtimeSvrFmt: unixTimeToStr(statRes.mtime),
      size: statRes.size, // local always unencrypted
      sizeRaw: statRes.size,
    };
  }

  async mkdir(key: string, mtime?: number, ctime?: number): Promise<Entity> {
    // console.debug(`mkdir: ${key}`);
    await mkdirpInVault(key, this.vault);
    return await this.stat(key);
  }

  async writeFile(
    key: string,
    content: ArrayBuffer,
    mtime: number,
    ctime: number
  ): Promise<Entity> {
    await this.vault.adapter.writeBinary(key, content, {
      mtime: mtime,
      ctime: ctime,
    });
    return await this.stat(key);
  }

  async readFile(key: string): Promise<ArrayBuffer> {
    return await this.vault.adapter.readBinary(key);
  }

  async rename(key1: string, key2: string): Promise<void> {
    return await this.vault.adapter.rename(key1, key2);
  }

  async rm(key: string): Promise<void> {
    if (this.deleteToWhere === "obsidian") {
      await this.vault.adapter.trashLocal(key);
    } else {
      // "system"
      if (!(await this.vault.adapter.trashSystem(key))) {
        await this.vault.adapter.trashLocal(key);
      }
    }
  }
  async checkConnect(callbackFunc?: any): Promise<boolean> {
    return true;
  }

  async getUserDisplayName(): Promise<string> {
    throw new Error("Method not implemented.");
  }

  async revokeAuth(): Promise<any> {
    throw new Error("Method not implemented.");
  }

  allowEmptyFile(): boolean {
    return true;
  }
}
