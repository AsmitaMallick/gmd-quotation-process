import { denyIfNoAccess } from "@/lib/access";
import { NextResponse } from "next/server";
import { getCreditors } from "@/lib/creditors-server";

export async function GET() {
  const denied = await denyIfNoAccess();
  if (denied) return denied;
  try {
    const data = await getCreditors();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
