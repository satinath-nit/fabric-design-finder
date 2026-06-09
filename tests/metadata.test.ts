import { describe, expect, it } from "vitest";
import { inferMetadataFromPath } from "../src/main/services/metadata";

describe("inferMetadataFromPath", () => {
  it("uses folder name as design name and filename as number/variant", () => {
    const metadata = inferMetadataFromPath(
      "/library/Jacquard Floral/D12345 Blue Variant.jpg",
      "/library/Jacquard Floral"
    );

    expect(metadata.designNumber).toBe("D12345");
    expect(metadata.designName).toBe("Jacquard Floral");
    expect(metadata.variant).toBe("Blue Variant");
  });

  it("falls back gracefully when no numeric code exists", () => {
    const metadata = inferMetadataFromPath("/library/Checks/Red Small Check.png", "/library");

    expect(metadata.designNumber).toBe("Red");
    expect(metadata.designName).toBe("Checks");
    expect(metadata.variant).toBe("Small Check");
  });
});
