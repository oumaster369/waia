/** RSS CDATA is a text container, not part of the publisher's headline. */
export function adminNewsText(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}
