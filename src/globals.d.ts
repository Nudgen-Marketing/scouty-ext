declare module "*.css?inline" {
  const text: string;
  export default text;
}
/** True only in a built entry bundle; false under vitest, so importing an entry module runs nothing. */
declare const __SCOUTY_ENTRY__: boolean;
/** True only in a development build (npm run build:dev). Store builds drop every branch behind it. */
declare const __SCOUTY_DEV__: boolean;
