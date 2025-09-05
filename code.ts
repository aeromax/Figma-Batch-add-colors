// Add Selected Swatches to Variables
// - Creates/updates COLOR variables from the selected swatches' visible SOLID fills.
// - Variable names are derived from the node's hierarchical name (Group / Name).
// - Collection: "Color Tokens", Mode: "Base".

function getOrCreateCollection(name: string): VariableCollection {
  const existing = figma.variables.getLocalVariableCollections().find(c => c.name === name);
  if (existing) return existing;
  const col = figma.variables.createVariableCollection(name);
  // Ensure at least one mode
  if (col.modes.length === 0) {
    col.renameMode(col.defaultModeId, "Base");
  }
  return col;
}

function getOrCreateMode(col: VariableCollection, modeName: string): string {
  const mode = col.modes.find(m => m.name === modeName);
  if (mode) return mode.modeId;
  return col.addMode(modeName);
}

function sanitizeName(s: string): string {
  // Figma Variables allow slashes for grouping. Just trim whitespace.
  return s.split("/").map(part => part.trim()).filter(Boolean).join(" / ");
}

function nodePathName(node: SceneNode): string {
  const parts: string[] = [];
  let cur: BaseNode | null = node;
  while (cur && cur.type !== "PAGE") {
    if ("name" in cur && cur.name) parts.push(cur.name);
    cur = cur.parent as BaseNode | null;
  }
  return sanitizeName(parts.reverse().join(" / "));
}

function findFirstSolid(node: SceneNode): SolidPaint | null {
  if ("fills" in node && Array.isArray(node.fills)) {
    const fills = node.fills as Paint[];
    const p = fills.find(p => p.type === "SOLID" && (p as SolidPaint).visible !== false) as SolidPaint | undefined;
    if (p) return p;
  }
  return null;
}

function approxArea(n: SceneNode): number {
  try {
    // Bounding box area is good enough for swatches
    const w = (n as any).width ?? 0;
    const h = (n as any).height ?? 0;
    return Math.max(0, Number(w) * Number(h));
  } catch (_e) {
    return 0;
  }
}

function findPaintedDescendant(node: SceneNode): { painted: SceneNode, paint: SolidPaint } | null {
  // Prefer solid fills on basic geometry (likely the swatch), pick the largest area
  const preferredTypes = new Set<SceneNode["type"]>([
    "RECTANGLE","ELLIPSE","POLYGON","STAR","VECTOR","BOOLEAN_OPERATION","LINE"
  ]);

  let best: { painted: SceneNode, paint: SolidPaint, area: number } | null = null;

  function visit(n: SceneNode) {
    const paint = findFirstSolid(n);
    if (paint) {
      const typeOk = preferredTypes.has(n.type);
      const area = approxArea(n);
      const score = (typeOk ? 10_000 : 0) + area; // strong bias toward preferred types
      if (!best || score > best.area) {
        best = { painted: n, paint, area: score };
      }
    }
    if ("children" in n) {
      for (const c of (n.children as readonly SceneNode[])) visit(c);
    }
  }

  visit(node);
  if (best) return { painted: best.painted, paint: best.paint };
  return null;
}

function toRGBA(paint: SolidPaint): RGBA {
  return {
    r: paint.color.r,
    g: paint.color.g,
    b: paint.color.b,
    a: paint.opacity === undefined ? 1 : paint.opacity
  };
}

function resolveRGBAFromPaint(paint: SolidPaint): RGBA {
  // If fill is bound to a variable, try to resolve its value; otherwise use the paint color
  const bv: any = (paint as any).boundVariables;
  const colorRef = bv?.color;
  if (colorRef) {
    let varId: string | null = null;
    if (typeof colorRef === "string") {
      varId = colorRef;
    } else if (typeof colorRef === "object" && colorRef && "id" in colorRef) {
      varId = String(colorRef.id);
    }
    if (varId) {
      const v = figma.variables.getVariableById(varId);
      if (v) {
        const col = figma.variables.getLocalVariableCollections().find(c => c.id === v.variableCollectionId);
        const modeForVar = col?.defaultModeId ?? Object.keys((v as any).valuesByMode ?? {})[0];
        const val = (v as any).valuesByMode?.[modeForVar];
        if (val && typeof val.r === "number" && typeof val.g === "number" && typeof val.b === "number") {
          // Ensure alpha is present
          return { r: val.r, g: val.g, b: val.b, a: typeof val.a === "number" ? val.a : 1 } as RGBA;
        }
      }
    }
  }
  return toRGBA(paint);
}

function findVariableByNameInCollection(name: string, colId: string): Variable | undefined {
  return figma.variables.getLocalVariables().find(v => v.variableCollectionId === colId && v.name === name);
}

function isColorishNode(n: SceneNode): boolean {
  const allowed = new Set([
    "RECTANGLE","ELLIPSE","POLYGON","STAR","VECTOR","BOOLEAN_OPERATION",
    "FRAME","GROUP","COMPONENT","COMPONENT_SET","INSTANCE","LINE"
  ]);
  return allowed.has(n.type);
}

async function run() {
  const selection = figma.currentPage.selection.filter(isColorishNode) as SceneNode[];
  if (selection.length === 0) {
    figma.notify("Select your swatches first. I’m not telepathic.");
    figma.closePlugin();
    return;
  }

  const collection = getOrCreateCollection("Color Tokens");
  const modeId = getOrCreateMode(collection, "Base");
  let created = 0, updated = 0, skipped = 0;

  for (const node of selection) {
    const found = findPaintedDescendant(node);
    if (!found) { skipped++; continue; }

    const name = sanitizeName(nodePathName(node));
    if (!name) { skipped++; continue; }

    const rgba = resolveRGBAFromPaint(found.paint);
    let variable = findVariableByNameInCollection(name, collection.id);

    if (!variable) {
      variable = figma.variables.createVariable(name, collection, "COLOR");
      created++;
    } else {
      updated++;
    }

    variable.setValueForMode(modeId, rgba);

    // Optional: bind the node's fill to the variable reference
    // if ("fills" in found.painted) {
    //   const paint: Paint = {
    //     type: "SOLID",
    //     visible: true,
    //     opacity: rgba.a,
    //     color: { r: rgba.r, g: rgba.g, b: rgba.b },
    //     boundVariables: { color: variable }
    //   };
    //   (found.painted as GeometryMixin).fills = [paint];
    // }
  }

  figma.notify(`Variables: ${created} created, ${updated} updated, ${skipped} skipped.`);
  figma.closePlugin();
}

run();
