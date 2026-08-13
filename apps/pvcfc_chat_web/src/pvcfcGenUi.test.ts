import { describe, expect, it } from "vitest";
import {
  createPvcfcGenUiModel,
  extractPvcfcSourceUrls,
} from "./pvcfcGenUi";

describe("PVCFC GenUI model", () => {
  it("extracts unique source URLs and removes punctuation", () => {
    expect(
      extractPvcfcSourceUrls(
        "Nguồn: https://pvcfc.com.vn/a. https://pvcfc.com.vn/a)",
      ),
    ).toEqual(["https://pvcfc.com.vn/a"]);
  });

  it("turns grounded answer paragraphs into a structured evidence card", () => {
    const model = createPvcfcGenUiModel(
      "NPK phù hợp được ghi trong hồ sơ PVCFC.\n\n- Thành phần theo hồ sơ.\n- Nguồn chính thức: https://pvcfc.com.vn/san-pham.",
    );

    expect(model.kind).toBe("evidence");
    expect(model.points).toEqual([
      "Thành phần theo hồ sơ.",
      "Nguồn chính thức: https://pvcfc.com.vn/san-pham.",
    ]);
    expect(model.sources).toEqual(["https://pvcfc.com.vn/san-pham"]);
    expect(model.actions).toHaveLength(2);
  });
});
