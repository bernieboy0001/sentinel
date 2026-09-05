"use client";

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { fmtPrice } from "@/lib/format";

export interface Pt {
  cycle: number;
  price: number;
}

export default function PriceChart({ points }: { points: Pt[] }) {
  const data = points.slice(-120);
  const color =
    data.length > 1
      ? data[data.length - 1].price >= data[data.length - 2].price
        ? "#4be0a3"
        : "#ff6b7a"
      : "#8f9dff";

  return (
    <div className="panel">
      <h3>The market — live</h3>
      <p className="sub">
        AUTH, the asset the AI trades. Every dot is one heartbeat (cycle).
      </p>
      {data.length < 2 ? (
        <div
          style={{
            height: 220,
            display: "grid",
            placeItems: "center",
            color: "var(--muted)",
            fontFamily: "var(--mono)",
            fontSize: 12.5,
            border: "1px dashed var(--border)",
            borderRadius: 8
          }}
        >
          drawing the chart as the price data streams in…
        </div>
      ) : (
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 5 }}>
              <defs>
                <linearGradient id="price" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="cycle"
                stroke="#2b3547"
                tick={{ fill: "#a7b0c6", fontSize: 10, fontFamily: "monospace" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={["auto", "auto"]}
                stroke="#2b3547"
                tick={{ fill: "#a7b0c6", fontSize: 10, fontFamily: "monospace" }}
                tickFormatter={(v: number) => fmtPrice(v)}
                width={58}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: "#171b27",
                  border: "1px solid #2b3547",
                  borderRadius: 8,
                  fontFamily: "monospace",
                  fontSize: 12
                }}
                labelFormatter={(l) => `heartbeat/cycle ${l}`}
                formatter={(v: number) => [fmtPrice(v), "AUTH price"]}
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke={color}
                strokeWidth={2}
                fill="url(#price)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}