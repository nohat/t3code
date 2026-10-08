import { useRef, type ComponentProps } from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "./tooltip";

/**
 * One line of text that truncates with an ellipsis and shows the whole string in a tooltip
 * on hover or focus, but only when it is actually cut off. The overflow check runs when the
 * tooltip is about to open, so there is no observer per row and a list of hundreds of these
 * costs the same as a plain `truncate`.
 *
 * Design systems (Carbon, PatternFly, Primer) reveal truncated text this way; scrolling the
 * text is motion WCAG 2.2.2 asks us to let users pause, so it is not an option here. Touch
 * has no hover, so on coarse pointers the text wraps to two lines instead of truncating.
 *
 * The look of the line comes from the caller: this is a bare span that inherits its font
 * and color from where it sits.
 */
export function TruncatedText({
  value,
  side = "top",
  align = "start",
  delay = 500,
  wrapOnTouch = true,
  className,
  ...props
}: Omit<ComponentProps<"span">, "children"> & {
  value: string;
  side?: ComponentProps<typeof TooltipPopup>["side"];
  align?: ComponentProps<typeof TooltipPopup>["align"];
  /** Hover time before the full text appears. Long enough not to flash while scanning a list. */
  delay?: number;
  /** Wrap to two lines on coarse pointers, where no hover can reveal the rest. */
  wrapOnTouch?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  return (
    // Base UI keeps the hover delay on the provider; a local one overrides the surrounding
    // instant-tooltip provider that pickers and the sidebar use for their buttons.
    <TooltipProvider delay={delay}>
      <Tooltip
        onOpenChange={(open, details) => {
          if (!open) return;
          const element = ref.current;
          if (!element || !isTextOverflowing(element)) details.cancel();
        }}
      >
        <TooltipTrigger
          render={
            <span
              ref={ref}
              className={cn(
                "block min-w-0 max-w-full truncate",
                wrapOnTouch && "pointer-coarse:line-clamp-2 pointer-coarse:whitespace-normal",
                className,
              )}
              {...props}
            />
          }
        >
          {value}
        </TooltipTrigger>
        <TooltipPopup side={side} align={align}>
          {value}
        </TooltipPopup>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Whether an element's content is wider than the box that clips it. */
export function isTextOverflowing(element: HTMLElement): boolean {
  return element.scrollWidth > element.clientWidth;
}
