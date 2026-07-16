// tsc has no knowledge of Vite's `?worker&inline` query suffix; this ambient
// declaration types the import as a `Worker` subclass constructor.
declare module "*?worker&inline" {
  const workerConstructor: new () => Worker;
  export default workerConstructor;
}
