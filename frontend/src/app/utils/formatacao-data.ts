const DATA = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function paraData(valor: string | null | undefined): Date | null {
  if (!valor) {
    return null;
  }
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

export function formatarData(valor: string | null | undefined): string {
  const data = paraData(valor);
  return data ? DATA.format(data) : '—';
}

export function formatarDataHora(valor: string | null | undefined): string {
  const data = paraData(valor);
  return data ? DATA_HORA.format(data) : '—';
}

export function formatarMoeda(valor: number | string | null | undefined): string {
  return valor === null || valor === undefined || valor === '' ? '—' : MOEDA.format(Number(valor));
}
