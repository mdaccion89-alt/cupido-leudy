import { jsPDF } from "jspdf";
import { supabase } from "@/integrations/supabase/client";

type License = {
  id: string;
  title: string;
  creator_name: string;
  created_at: string;
  genre: string;
  fingerprint: string;
  content_id_eligible: boolean;
};

export async function downloadCertificate(songId: string) {
  const { data, error } = await supabase.rpc("verify_license", { _song_id: songId });
  if (error) throw error;
  const license = data?.[0] as License | undefined;
  if (!license) throw new Error("No se encontró la licencia de esta canción.");

  const pdf = new jsPDF();
  pdf.setFillColor(18, 18, 28);
  pdf.rect(0, 0, 210, 297, "F");
  pdf.setTextColor(236, 232, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(24);
  pdf.text("Cupido Leudy ❤️", 20, 28);
  pdf.setFontSize(11);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(170, 162, 210);
  pdf.text("Certificado de creacion y licencia de obra musical", 20, 37);

  pdf.setDrawColor(124, 58, 237);
  pdf.line(20, 44, 190, 44);

  pdf.setTextColor(236, 232, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text(license.title.slice(0, 46), 20, 62);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  const lines = [
    `ID de obra: ${license.id}`,
    `Creador: ${license.creator_name}`,
    `Genero: ${license.genre}`,
    `Fecha: ${new Date(license.created_at).toLocaleString("es")}`,
    `Huella digital: ${license.fingerprint || "N/D"}`,
    `Elegible para Content ID: ${license.content_id_eligible ? "Si" : "No"}`,
    "",
    "Este documento certifica que la obra fue creada originalmente",
    "por el usuario indicado mediante Cupido Leudy ❤️.",
    "Verificacion online: /verify?song=" + license.id,
  ];
  let y = 78;
  for (const line of lines) {
    pdf.text(line, 20, y);
    y += 7;
  }
  pdf.setTextColor(170, 162, 210);
  pdf.setFontSize(9);
  pdf.text("Documento generado electronicamente por Cupido Leudy ❤️", 20, 275);
  pdf.save(`certificado-${license.id.slice(0, 8)}.pdf`);
}
