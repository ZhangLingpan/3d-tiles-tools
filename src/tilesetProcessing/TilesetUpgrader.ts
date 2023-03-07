import { Buffers } from "../base/Buffers";
import { DeveloperError } from "../base/DeveloperError";

import { BufferedContentData } from "../contentTypes/BufferedContentData";
import { ContentDataTypeRegistry } from "../contentTypes/ContentDataTypeRegistry";

import { Tile } from "../structure/Tile";
import { Tileset } from "../structure/Tileset";
import { Content } from "../structure/Content";

import { TilesetError } from "../tilesetData/TilesetError";
import { TilesetSource } from "../tilesetData/TilesetSource";
import { TilesetTarget } from "../tilesetData/TilesetTarget";
import { TilesetTargets } from "../tilesetData/TilesetTargets";
import { TilesetSources } from "../tilesetData/TilesetSources";

import { Tiles } from "../tilesets/Tiles";
import { Tilesets } from "../tilesets/Tilesets";

import { TileFormats } from "../tileFormats/TileFormats";

import { GltfUtilities } from "../contentOperations/GtlfUtilities";
import { ContentOps } from "../contentOperations/ContentOps";

/**
 * The options for the upgrade. This is only used internally,
 * as a collection of flags to enable/disable certain parts
 * of the update.
 *
 * The exact set of options (and how they may eventually
 * be exposed to the user) still have to be decided.
 */
type UpgradeOptions = {
  upgradeAssetVersionNumber: boolean;
  upgradeRefineCase: boolean;
  upgradeContentUrlToUri: boolean;
  upgradeB3dmGltf1ToGltf2: boolean;
  upgradeI3dmGltf1ToGltf2: boolean;
};

/**
 * A class for "upgrading" a tileset from a previous version to
 * a more recent version. The details of what that means exactly
 * are not (yet) specified.
 */
export class TilesetUpgrader {
  /**
   * A function that will receive log messages during the upgrade process
   */
  private readonly logCallback: (message: any) => void;

  /**
   * The tileset source for the input
   */
  private tilesetSource: TilesetSource | undefined;

  /**
   * The tileset target for the output.
   */
  private tilesetTarget: TilesetTarget | undefined;

  /**
   * The options for the upgrade.
   */
  private readonly upgradeOptions: UpgradeOptions;

  /**
   * Creates a new instance
   *
   * @param quiet - Whether log messages should be omitted
   */
  constructor(quiet?: boolean) {
    if (quiet !== true) {
      this.logCallback = (message: any) => console.log(message);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function
      this.logCallback = (message: any) => {};
    }

    // By default, ALL options are enabled
    this.upgradeOptions = {
      upgradeAssetVersionNumber: true,
      upgradeRefineCase: true,
      upgradeContentUrlToUri: true,
      upgradeB3dmGltf1ToGltf2: true,
      upgradeI3dmGltf1ToGltf2: true,
    };
  }

  /**
   * Upgrade the specified source tileset, and write it to the given
   * target.
   *
   * @param tilesetSourceName - The tileset source name
   * @param tilesetTargetName - The tileset target name
   * @param overwrite Whether the target should be overwritten if
   * it already exists
   * @returns A promise that resolves when the process is finished
   * @throws TilesetError When the input could not be processed,
   * or when the output already exists and `overwrite` was `false`.
   */
  async upgrade(
    tilesetSourceName: string,
    tilesetTargetName: string,
    overwrite: boolean
  ): Promise<void> {
    const tilesetSource = TilesetSources.createAndOpen(tilesetSourceName);
    const tilesetTarget = TilesetTargets.createAndBegin(
      tilesetTargetName,
      overwrite
    );

    this.tilesetSource = tilesetSource;
    this.tilesetTarget = tilesetTarget;

    const tilesetSourceJsonFileName =
      Tilesets.determineTilesetJsonFileName(tilesetSourceName);

    const tilesetTargetJsonFileName =
      Tilesets.determineTilesetJsonFileName(tilesetTargetName);

    await this.upgradeInternal(
      tilesetSourceJsonFileName,
      tilesetTargetJsonFileName
    );
    await this.upgradeResources(tilesetSourceJsonFileName);

    tilesetSource.close();
    await tilesetTarget.end();

    this.tilesetSource = undefined;
    this.tilesetTarget = undefined;
  }

  /**
   * Internal method for the actual upgrade.
   *
   * It justo obtains the tileset JSON data from the source, passes
   * it to `upgradeTileset`, and writes the result under the given
   * name into the target.
   *
   * @param tilesetSourceJsonFileName - The name of the tileset JSON in the source
   * @param tilesetTargetJsonFileName - The name of the tileset JSON in the target
   * @returns A promise that resolves when the process is finished
   * @throws TilesetError When the input could not be processed
   */
  private async upgradeInternal(
    tilesetSourceJsonFileName: string,
    tilesetTargetJsonFileName: string
  ): Promise<void> {
    if (!this.tilesetSource || !this.tilesetTarget) {
      throw new DeveloperError("The source and target must be defined");
    }

    // Obtain the tileset JSON buffer (unzip it if necessary)
    // and parse the Tileset out of it
    let tilesetJsonBuffer = this.tilesetSource.getValue(
      tilesetSourceJsonFileName
    );
    if (!tilesetJsonBuffer) {
      const message = `No ${tilesetSourceJsonFileName} found in input`;
      throw new TilesetError(message);
    }
    let tilesetJsonBufferWasZipped = false;
    if (Buffers.isGzipped(tilesetJsonBuffer)) {
      tilesetJsonBufferWasZipped = true;
      tilesetJsonBuffer = Buffers.gunzip(tilesetJsonBuffer);
    }
    const tileset = JSON.parse(tilesetJsonBuffer.toString()) as Tileset;

    // Perform the actual upgrade
    await this.upgradeTileset(tileset);

    // Put the upgraded tileset JSON buffer into the target
    // (zipping it, if the input was zipped)
    const resultTilesetJsonString = JSON.stringify(tileset, null, 2);
    let resultTilesetJsonBuffer = Buffer.from(resultTilesetJsonString);
    if (tilesetJsonBufferWasZipped) {
      resultTilesetJsonBuffer = ContentOps.gzipBuffer(resultTilesetJsonBuffer);
    }
    this.tilesetTarget.addEntry(
      tilesetTargetJsonFileName,
      resultTilesetJsonBuffer
    );
  }

  /**
   * Upgrades the given tileset, in place.
   *
   * @param tileset - The parsed tileset
   */
  async upgradeTileset(tileset: Tileset): Promise<void> {
    if (this.upgradeOptions.upgradeAssetVersionNumber) {
      this.logCallback(`Upgrading asset version number`);
      await this.upgradeAssetVersionNumber(tileset);
    }
    if (this.upgradeOptions.upgradeRefineCase) {
      this.logCallback(`Upgrading refine to be in uppercase`);
      await this.upgradeRefineValues(tileset);
    }
    if (this.upgradeOptions.upgradeContentUrlToUri) {
      this.logCallback(`Upgrading content.url to content.uri`);
      await this.upgradeEachContentUrlToUri(tileset);
    }
  }

  /**
   * Upgrade the `asset.version` number in the given tileset
   * to be "1.1".
   *
   * @param tileset - The tileset
   */
  private upgradeAssetVersionNumber(tileset: Tileset) {
    if (tileset.asset.version !== "1.1") {
      this.logCallback(
        `  Upgrading asset version from ${tileset.asset.version} to 1.1`
      );
      tileset.asset.version = "1.1";
    }
  }

  /**
   * Upgrade the `url` property of each tile content to `uri`.
   *
   * This will examine each `tile.content` in the explicit representation
   * of the tile hierarchy in the given tileset. If any content does not
   * define a `uri`, but a (legacy) `url` property, then a warning is
   * printed and the `url` is renamed to `uri`.
   *
   * @param tileset - The tileset
   */
  private async upgradeEachContentUrlToUri(tileset: Tileset) {
    const root = tileset.root;
    await Tiles.traverseExplicit(root, async (tilePath: Tile[]) => {
      const tile = tilePath[tilePath.length - 1];
      if (tile.content) {
        this.upgradeContentUrlToUri(tile.content);
      }
      if (tile.contents) {
        for (const content of tile.contents) {
          this.upgradeContentUrlToUri(content);
        }
      }
      return true;
    });
  }

  /**
   * If the given `Content` does not have a `uri` but uses the
   * legacy `url` property, then a message is logged, and the
   * `url` property is renamed to `uri`.
   *
   * @param content - The `Content`
   */
  private upgradeContentUrlToUri(content: Content): void {
    if (content.uri) {
      return;
    }
    const legacyContent = content as any;
    if (legacyContent.url) {
      this.logCallback(
        `  Renaming 'url' property for content ${legacyContent.url} to 'uri'`
      );
      content.uri = legacyContent.url;
      delete legacyContent.url;
      return;
    }
    // This should never be the case:
    this.logCallback(
      "  The content does not have a 'uri' property (and no legacy 'url' property)"
    );
  }

  /**
   * Upgrade the `refine` property of each tile to be written in
   * uppercase letters.
   *
   * @param tileset - The tileset
   */
  private async upgradeRefineValues(tileset: Tileset) {
    const root = tileset.root;
    await Tiles.traverseExplicit(root, async (tilePath: Tile[]) => {
      const tile = tilePath[tilePath.length - 1];
      if (tile.refine && tile.refine !== "ADD" && tile.refine !== "REPLACE") {
        const oldValue = tile.refine;
        const newValue = oldValue.toUpperCase();
        this.logCallback(
          `  Renaming 'refine' value from ${oldValue} to ${newValue}`
        );
        tile.refine = newValue;
      }
      return true;
    });
  }

  /**
   * Upgrade all resources from the tileset source (except for the
   * file with the given name) and put them into the tileset target.
   *
   * @param tilesetSourceJsonFileName - The name of the tileset JSON file
   * in the source
   * @returns A promise that resolves when the process is finished.
   */
  private async upgradeResources(
    tilesetSourceJsonFileName: string
  ): Promise<void> {
    if (!this.tilesetSource || !this.tilesetTarget) {
      throw new DeveloperError("The source and target must be defined");
    }
    const entries = TilesetSources.getEntries(this.tilesetSource);
    for (const entry of entries) {
      const key = entry.key;
      if (key === tilesetSourceJsonFileName) {
        continue;
      }
      const sourceValue = entry.value;
      const contentData = new BufferedContentData(key, sourceValue);
      const type = await ContentDataTypeRegistry.findContentDataType(
        contentData
      );
      const targetValue = await this.processValue(key, sourceValue, type);
      this.tilesetTarget.addEntry(key, targetValue);
    }
  }

  /**
   * Process the value of an entry (i.e. the data of one file), and return
   * a possibly "upgraded" version of that value.
   *
   * @param key - The key (file name)
   * @param value - The value (file contents buffer)
   * @param type - The type of the content. See `ContentDataTypes`.
   * @returns A promise that resolves when the value is processed.
   */
  private async processValue(
    key: string,
    value: Buffer,
    type: string | undefined
  ): Promise<Buffer> {
    if (type === "CONTENT_TYPE_B3DM") {
      if (this.upgradeOptions.upgradeB3dmGltf1ToGltf2) {
        this.logCallback(`  Upgrading GLB in ${key}`);
        value = await TilesetUpgrader.upgradeB3dmGltf1ToGltf2(value);
      } else {
        this.logCallback(`  Not upgrading GLB in ${key} (disabled via option)`);
      }
    } else if (type === "CONTENT_TYPE_I3DM") {
      if (this.upgradeOptions.upgradeI3dmGltf1ToGltf2) {
        this.logCallback(`  Upgrading GLB in ${key}`);
        value = await TilesetUpgrader.upgradeI3dmGltf1ToGltf2(value);
      } else {
        this.logCallback(`  Not upgrading GLB in ${key} (disabled via option)`);
      }
    } else {
      this.logCallback(`  No upgrade operation to perform for ${key}`);
    }
    return value;
  }

  /**
   * For the given B3DM data buffer, extract the GLB, upgrade it
   * with `GltfUtilities.upgradeGlb`, create a new B3DM from the
   * result, and return it.
   *
   * @param inputBuffer - The input buffer
   * @returns The upgraded buffer
   */
  private static async upgradeB3dmGltf1ToGltf2(
    inputBuffer: Buffer
  ): Promise<Buffer> {
    const inputTileData = TileFormats.readTileData(inputBuffer);
    const inputGlb = inputTileData.payload;
    const outputGlb = await GltfUtilities.upgradeGlb(inputGlb);
    const outputTileData = TileFormats.createB3dmTileDataFromGlb(
      outputGlb,
      inputTileData.featureTable.json,
      inputTileData.featureTable.binary,
      inputTileData.batchTable.json,
      inputTileData.batchTable.binary
    );
    const outputBuffer = TileFormats.createTileDataBuffer(outputTileData);
    return outputBuffer;
  }

  /**
   * For the given I3DM data buffer, extract the GLB, upgrade it
   * with `GltfUtilities.upgradeGlb`, create a new B3DM from the
   * result, and return it.
   *
   * @param inputBuffer - The input buffer
   * @returns The upgraded buffer
   */
  private static async upgradeI3dmGltf1ToGltf2(
    inputBuffer: Buffer
  ): Promise<Buffer> {
    const inputTileData = TileFormats.readTileData(inputBuffer);
    const inputGlb = inputTileData.payload;
    const outputGlb = await GltfUtilities.upgradeGlb(inputGlb);
    const outputTileData = TileFormats.createI3dmTileDataFromGlb(
      outputGlb,
      inputTileData.featureTable.json,
      inputTileData.featureTable.binary,
      inputTileData.batchTable.json,
      inputTileData.batchTable.binary
    );
    const outputBuffer = TileFormats.createTileDataBuffer(outputTileData);
    return outputBuffer;
  }
}
