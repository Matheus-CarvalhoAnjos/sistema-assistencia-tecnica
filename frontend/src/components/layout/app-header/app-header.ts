import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UsuarioAutenticado } from '../../../app/models/usuario-autenticado';

const NOMES_PERFIL: Record<string, string> = {
  ADMINISTRADOR: 'Administrador',
  ATENDENTE: 'Atendente',
  TECNICO: 'Técnico',
};

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './app-header.html',
  styleUrl: './app-header.css',
})
export class AppHeader {
  readonly usuario = input<UsuarioAutenticado | null>(null);
  readonly sair = output<void>();

  readonly perfilLegivel = computed(() => {
    const perfil = this.usuario()?.perfil?.trim();
    return perfil ? (NOMES_PERFIL[perfil.toUpperCase()] ?? perfil) : '';
  });

  readonly iniciais = computed(() => {
    const nome = this.usuario()?.nome.trim();

    if (!nome) {
      return '';
    }

    // Considera só palavras que começam por letra: "Ana Atendente (demo)" → "AA", não "A(".
    const palavras = nome.split(/\s+/).filter((p) => /^\p{L}/u.test(p));
    const partes = palavras.length ? palavras : [nome];
    return partes.length > 1
      ? `${partes[0][0]}${partes[partes.length - 1][0]}`.toUpperCase()
      : partes[0].slice(0, 2).toUpperCase();
  });
}
