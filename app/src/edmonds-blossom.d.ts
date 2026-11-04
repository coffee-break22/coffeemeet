declare module "edmonds-blossom" {
  export default function blossom(
    edges: Array<[number, number, number]>,
    maxCardinality?: boolean,
  ): number[];
}
