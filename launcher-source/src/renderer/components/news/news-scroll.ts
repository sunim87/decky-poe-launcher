export const EXPANDED_NEWS_SCROLL_MARGIN = 4;

export type ExpandedNewsScrollSnapshot = {
  containerScrollTop: number;
  containerTop: number;
  containerBottom: number;
  itemTop: number;
  itemBottom: number;
  contentBottom?: number;
  margin?: number;
};

export function getExpandedNewsScrollTop(
  snapshot: ExpandedNewsScrollSnapshot,
): number | null {
  const margin = snapshot.margin ?? EXPANDED_NEWS_SCROLL_MARGIN;
  const bottom = snapshot.contentBottom ?? snapshot.itemBottom;
  const isItemAboveView = snapshot.itemTop < snapshot.containerTop;
  const isExpandedContentClipped = bottom > snapshot.containerBottom;

  if (!isItemAboveView && !isExpandedContentClipped) {
    return null;
  }

  return Math.max(
    0,
    snapshot.containerScrollTop +
      snapshot.itemTop -
      snapshot.containerTop -
      margin,
  );
}

export function scrollExpandedNewsItemIntoView(itemElement: HTMLElement) {
  const scrollContainer = itemElement.closest(
    ".news-list",
  ) as HTMLElement | null;
  if (!scrollContainer) return;

  const itemRect = itemElement.getBoundingClientRect();
  const containerRect = scrollContainer.getBoundingClientRect();
  const contentWrapper = itemElement.querySelector(
    ".news-item-content-wrapper",
  ) as HTMLElement | null;
  const contentRect = contentWrapper?.getBoundingClientRect();

  const targetTop = getExpandedNewsScrollTop({
    containerScrollTop: scrollContainer.scrollTop,
    containerTop: containerRect.top,
    containerBottom: containerRect.bottom,
    itemTop: itemRect.top,
    itemBottom: itemRect.bottom,
    contentBottom: contentRect?.bottom,
  });

  if (targetTop === null) return;

  scrollContainer.scrollTo({
    top: targetTop,
    behavior: "smooth",
  });
}
