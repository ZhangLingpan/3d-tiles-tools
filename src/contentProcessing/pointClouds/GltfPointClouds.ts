import { Document } from "@gltf-transform/core";
import { NodeIO } from "@gltf-transform/core";
import { Accessor } from "@gltf-transform/core";
import { Primitive } from "@gltf-transform/core";
import { PointCloudReader } from "./PointCloudReader";
import { TileFormatError } from "../../tileFormats/TileFormatError";
import { Iterables } from "../../base/Iterables";
import { MeshFeatures } from "../gltftransform/MeshFeatures";

export class GltfPointClouds {
  static async build(pointCloudReader: PointCloudReader) {
    const document = new Document();

    const buffer = document.createBuffer();
    buffer.setURI("buffer.bin");

    const primitive = document.createPrimitive();
    primitive.setMode(Primitive.Mode.POINTS);

    const positions = pointCloudReader.getAttributeValues("POSITION");
    if (!positions) {
      throw new TileFormatError("No POSITION attribute found");
    }
    const positionAccessor = document.createAccessor();
    positionAccessor.setBuffer(buffer);
    positionAccessor.setType(Accessor.Type.VEC3);
    positionAccessor.setArray(new Float32Array([...positions]));
    primitive.setAttribute("POSITION", positionAccessor);

    const normals = pointCloudReader.getAttributeValues("NORMAL");
    if (normals) {
      const normalAccessor = document.createAccessor();
      normalAccessor.setBuffer(buffer);
      normalAccessor.setType(Accessor.Type.VEC3);
      normalAccessor.setArray(new Float32Array([...normals]));
      primitive.setAttribute("NORMAL", normalAccessor);
    }

    const colors = pointCloudReader.getAttributeValues("COLOR_0");
    if (colors) {
      const colorAccessor = document.createAccessor();
      colorAccessor.setBuffer(buffer);
      colorAccessor.setType(Accessor.Type.VEC4);

      colorAccessor.setNormalized(true);
      const colorsBytes = Iterables.map(colors, (c: number) => 255.0 * c);

      colorAccessor.setArray(new Uint8Array([...colorsBytes]));
      primitive.setAttribute("COLOR_0", colorAccessor);
    }

    const globalColor = pointCloudReader.getGlobalColor();
    if (globalColor) {
      const material = document.createMaterial();
      material.setBaseColorFactor(globalColor);
      material.setMetallicFactor(0.0);
      material.setRoughnessFactor(1.0);
      primitive.setMaterial(material);
    }

    //===
    const featureIdValues =
      pointCloudReader.getAttributeValues("_FEATURE_ID_0");
    if (featureIdValues) {
      const featureIdValuesArray = [...featureIdValues];
      const featureIdAccessor = document.createAccessor();
      featureIdAccessor.setBuffer(buffer);
      featureIdAccessor.setType(Accessor.Type.SCALAR);
      featureIdAccessor.setArray(new Uint16Array(featureIdValuesArray));
      primitive.setAttribute("_FEATURE_ID_0", featureIdAccessor);

      const attribute = 0;
      const featureCount = new Set(featureIdValuesArray).size;
      GltfPointClouds.assignExtension(
        document,
        primitive,
        attribute,
        featureCount
      );
    }
    //===

    const mesh = document.createMesh();
    mesh.addPrimitive(primitive);

    const node = document.createNode();
    node.setMesh(mesh);

    const scene = document.createScene();
    scene.addChild(node);

    const io = new NodeIO();
    io.registerExtensions([MeshFeatures]);
    const glb = await io.writeBinary(document);
    return Buffer.from(glb);
  }

  private static assignExtension(
    document: Document,
    primitive: Primitive,
    attribute: number,
    featureCount: number
  ) {
    const meshFeatures = document.createExtension(MeshFeatures);
    const meshFeature = meshFeatures.createMeshFeature();
    const featureId = meshFeatures.createFeatureId();
    featureId.setAttribute(attribute);
    featureId.setFeatureCount(featureCount);
    meshFeature.addFeatureId(featureId);
    primitive.setExtension("EXT_mesh_features", meshFeature);
  }
}