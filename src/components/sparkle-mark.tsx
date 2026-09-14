import { cn } from "@/lib/utils";

export function SparkleMark({ className }: { className?: string }) {
  return (
    <img
      src="/logo.png?v=3"
      alt=""
      className={cn("size-7 shrink-0 object-contain", className)}
      aria-hidden="true"
    />
  );
}
