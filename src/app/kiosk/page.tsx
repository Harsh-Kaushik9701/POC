import { Kiosk } from "./Kiosk";
import "./kiosk.css";

export const metadata = { title: "Kiosk" };

export default async function KioskPage({ searchParams }: { searchParams: Promise<{ device?: string }> }) {
  const { device } = await searchParams;
  return <Kiosk initialToken={device ?? null} />;
}
