import { Component, computed, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { UsuarioAutenticado } from '../../../app/models/usuario-autenticado';

type PerfilUsuario = 'ADMINISTRADOR' | 'ATENDENTE' | 'TECNICO';

interface ItemNavegacao {
  titulo: string;
  rota: string | null;
  perfis: readonly PerfilUsuario[] | null;
}

@Component({
  selector: 'app-top-navigation',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './top-navigation.html',
  styleUrl: './top-navigation.css',
})
export class TopNavigation {
  readonly usuario = input<UsuarioAutenticado | null>(null);

  private readonly opcoes: readonly ItemNavegacao[] = [
    { titulo: 'Início', rota: '/', perfis: null },
    { titulo: 'Clientes', rota: '/clientes', perfis: ['ADMINISTRADOR', 'ATENDENTE'] },
    { titulo: 'Solicitações', rota: '/solicitacoes', perfis: ['ADMINISTRADOR', 'ATENDENTE'] },
    // P6: orçamentos, pagamentos e expedição são tratados nos detalhes de cada OS
    // (a lista do Início filtra por status); os itens desativados foram removidos.
    { titulo: 'Usuários', rota: '/usuarios', perfis: ['ADMINISTRADOR'] },
  ];

  readonly itensVisiveis = computed(() => {
    const perfil = this.usuario()?.perfil.trim().toUpperCase() as PerfilUsuario | undefined;

    return this.opcoes.filter(
      (item) => item.perfis === null || (!!perfil && item.perfis.includes(perfil)),
    );
  });
}
