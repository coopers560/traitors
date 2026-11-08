import qrcode from "qrcode-generator";
import { useMemo } from "react";
import { View } from "react-native";

/**
 * A self-contained QR code rendered with plain Views — no SVG, no canvas, works
 * on web and native, offline. Always true black on white with a quiet-zone
 * margin so phone cameras can read it, whatever the app theme.
 */
export function QrCode({ value, size = 232, quietZone = 4 }: { value: string; size?: number; quietZone?: number }) {
  const { count, rows, cell } = useMemo(() => {
    const qr = qrcode(0, "M"); // 0 = auto version, M = ~15% error correction
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    const c = size / (n + quietZone * 2);
    // Merge runs of dark modules in each row into single rectangles (fewer Views).
    const out: { r: number; x: number; len: number }[][] = [];
    for (let r = 0; r < n; r++) {
      const segs: { r: number; x: number; len: number }[] = [];
      let col = 0;
      while (col < n) {
        if (qr.isDark(r, col)) {
          let len = 1;
          while (col + len < n && qr.isDark(r, col + len)) len++;
          segs.push({ r, x: col, len });
          col += len;
        } else {
          col++;
        }
      }
      out.push(segs);
    }
    return { count: n, rows: out, cell: c };
  }, [value, size, quietZone]);

  const inner = count * cell;
  return (
    <View style={{ width: size, height: size, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: inner, height: inner }}>
        {rows.map((segs) =>
          segs.map(({ r, x, len }) => (
            <View
              key={`${r}-${x}`}
              style={{
                position: "absolute",
                top: r * cell,
                left: x * cell,
                width: len * cell,
                height: cell,
                backgroundColor: "#000000",
              }}
            />
          )),
        )}
      </View>
    </View>
  );
}
