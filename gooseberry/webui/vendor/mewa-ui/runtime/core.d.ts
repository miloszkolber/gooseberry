export interface MewaBehavior<State = unknown> {
  readonly name: string;
  enhance(root: ParentNode, options?: unknown): State | void;
  destroy?(root: ParentNode, state?: State): void;
}

export interface MewaController {
  readonly element: ParentNode;
  update(options?: unknown): void;
  destroy(): void;
}

export declare function queryAll(root: ParentNode | null | undefined, selector: string): Element[];
export declare function createController(behavior: MewaBehavior, root: ParentNode, options?: unknown): MewaController;
