import { describe, expect, it } from "vitest";
import { buildTree, DEFAULT_FOLDERS, effectiveFolder, fileKind, folderForCategory, formatSize, inFolder, isDefaultFolder, normalizeFolderPath, summarize } from "./docs";

describe("file kinds + sizes", () => {
  it("classifies by extension, case-insensitively", () => {
    expect(fileKind("Riser_Duct_Drawing.DWG")).toBe("dwg");
    expect(fileKind("plan.dxf")).toBe("dwg");
    expect(fileKind("Project_Report.pdf")).toBe("pdf");
    expect(fileKind("BOQ.xlsx")).toBe("xls");
    expect(fileKind("photo.JPG")).toBe("image");
    expect(fileKind("notes.docx")).toBe("other");
    expect(fileKind("noextension")).toBe("other");
  });
  it("formats sizes", () => {
    expect(formatSize(null)).toBe("—");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(820 * 1024)).toBe("820 KB");
    expect(formatSize(2.4 * 1024 * 1024)).toBe("2.4 MB");
    expect(formatSize(1.5 * 1024 ** 3)).toBe("1.5 GB");
  });
  it("summarises counts and bytes; images count as Other", () => {
    const s = summarize([{ kind: "pdf", size: 100 }, { kind: "pdf", size: null }, { kind: "dwg", size: 50 }, { kind: "xls", size: 1 }, { kind: "image", size: 9 }, { kind: "other", size: 0 }]);
    expect(s).toEqual({ total: 6, bytes: 160, pdf: 2, dwg: 1, xls: 1, other: 2 });
  });
});

describe("folders", () => {
  it("derives a folder from the category when none is set", () => {
    expect(effectiveFolder({ folder: null, category: "DRAWING" })).toBe("Engineering/Drawings");
    expect(effectiveFolder({ folder: "Installation/Reports", category: "DRAWING" })).toBe("Installation/Reports");
    expect(folderForCategory("EMAIL")).toBe("Others");
    expect(DEFAULT_FOLDERS).toContain(folderForCategory("PURCHASE_ORDER"));
  });
  it("matches a folder and its children but not look-alikes", () => {
    expect(inFolder("Engineering/Drawings", "Engineering")).toBe(true);
    expect(inFolder("Engineering", "Engineering")).toBe(true);
    expect(inFolder("EngineeringX/Drawings", "Engineering")).toBe(false);
  });
  it("validates folder paths", () => {
    expect(normalizeFolderPath("  Engineering /  Site   Photos ")).toEqual({ ok: true, path: "Engineering/Site Photos" });
    expect(normalizeFolderPath("///").ok).toBe(false);
    expect(normalizeFolderPath("a/b/c/d").ok).toBe(false);
    expect(normalizeFolderPath("x".repeat(41)).ok).toBe(false);
    expect(normalizeFolderPath("bad\\name").ok).toBe(false);
  });
  it("knows which folders are part of the standard tree", () => {
    expect(isDefaultFolder("Engineering")).toBe(true);
    expect(isDefaultFolder("Engineering/Drawings")).toBe(true);
    expect(isDefaultFolder("Engineering/Site Photos")).toBe(false);
  });
  it("builds the tree with roll-up counts, custom folders and Others last", () => {
    const tree = buildTree(["Engineering/Drawings", "Engineering/Drawings", "Others", "Engineering/Site Photos"], ["Engineering/Site Photos", "Client Docs/RFIs"]);
    const eng = tree.find((n) => n.path === "Engineering")!;
    expect(eng.count).toBe(3);
    expect(eng.children.map((c) => c.name)).toEqual(["Drawings", "Calculations", "Site Photos"]);
    expect(eng.children.find((c) => c.name === "Drawings")!.count).toBe(2);
    expect(eng.children.find((c) => c.name === "Site Photos")!.custom).toBe(true);
    const client = tree.find((n) => n.path === "Client Docs")!;
    expect(client.custom).toBe(true);
    expect(client.children[0].path).toBe("Client Docs/RFIs");
    expect(tree[tree.length - 1].path).toBe("Others");
  });
});
