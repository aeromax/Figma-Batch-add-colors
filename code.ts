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

function findFirstSolid(node: SceneNode): Paint | null {
  if ("fills" in node && Array.isArray(node.fills)) {
    const fills = node.fills as Paint[];
    const p = fills.find(p => p.type === "SOLID" && (p as SolidPaint).visible !== false);
    if (p) return p;
  }
  return null;
}

function findPaintedDescendant(node: SceneNode): { painted: SceneNode, paint: SolidPaint } | null {
  const paint = findFirstSolid(node) as SolidPaint | null;
  if (paint) return { painted: node, paint };
  if ("children" in node) {
    for (const child of node.children as readonly SceneNode[]) {
      const found = findPaintedDescendant(child);
      if (found) return found;
    }
  }
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

    const rgba = toRGBA(found.paint);
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
