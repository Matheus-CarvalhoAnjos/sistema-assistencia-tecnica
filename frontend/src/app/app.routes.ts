import { Routes } from '@angular/router';
import { DashboardPage } from '../pages/dashboard/dashboard';
import { authGuard, perfilGuard, somenteVisitanteGuard } from './auth/auth.guards';
import { PerfilUsuario } from './models/usuario-autenticado';

/** Perfis com acesso ao módulo de Clientes (o backend aplica a mesma regra). */
const PERFIS_CLIENTES: readonly PerfilUsuario[] = ['ADMINISTRADOR', 'ATENDENTE'];

/** TÉCNICO não vê nem acessa Solicitações (o backend aplica a mesma regra). */
const PERFIS_SOLICITACOES: readonly PerfilUsuario[] = ['ADMINISTRADOR', 'ATENDENTE'];

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [somenteVisitanteGuard],
    loadComponent: () => import('../pages/login/login').then((m) => m.LoginPage),
    title: 'Entrar',
  },
  { path: '', component: DashboardPage, canActivate: [authGuard], title: 'Início' },
  {
    path: 'clientes',
    canActivate: [authGuard, perfilGuard],
    data: { perfis: PERFIS_CLIENTES },
    children: [
      {
        path: '',
        loadComponent: () => import('../pages/clientes/clientes').then((m) => m.ClientesPage),
        title: 'Clientes',
      },
      {
        path: 'novo',
        loadComponent: () =>
          import('../pages/clientes/cliente-form').then((m) => m.ClienteFormPage),
        title: 'Novo cliente',
      },
      {
        path: ':id',
        loadComponent: () =>
          import('../pages/clientes/cliente-detalhe').then((m) => m.ClienteDetalhePage),
        title: 'Cliente',
      },
      {
        path: ':id/editar',
        loadComponent: () =>
          import('../pages/clientes/cliente-form').then((m) => m.ClienteFormPage),
        title: 'Editar cliente',
      },
    ],
  },
  {
    // Solicitações: somente abertura; a consulta é feita pelas Ordens de Serviço
    path: 'solicitacoes',
    canActivate: [authGuard, perfilGuard],
    data: { perfis: PERFIS_SOLICITACOES },
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'nova' },
      {
        path: 'nova',
        loadComponent: () =>
          import('../pages/solicitacoes/nova-solicitacao').then((m) => m.NovaSolicitacaoPage),
        title: 'Nova solicitação',
      },
    ],
  },
  {
    // Detalhes da OS: todos os perfis; o backend responde 404 para OS de outro técnico.
    // Não há item de menu: a lista de OS fica no Início (decisão de layout).
    path: 'ordens-servico/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('../pages/ordens-servico/ordem-servico-detalhe').then((m) => m.OrdemServicoDetalhePage),
    title: 'Ordem de Serviço',
  },
  {
    // Catálogo de acessórios (acessado pela abertura de solicitação; sem item no menu principal)
    path: 'acessorios',
    canActivate: [authGuard, perfilGuard],
    data: { perfis: PERFIS_SOLICITACOES },
    loadComponent: () => import('../pages/acessorios/acessorios').then((m) => m.AcessoriosPage),
    title: 'Acessórios',
  },
  {
    // Gestão de usuários: somente ADMINISTRADOR (a API aplica a mesma regra)
    path: 'usuarios',
    canActivate: [authGuard, perfilGuard],
    data: { perfis: ['ADMINISTRADOR'] satisfies readonly PerfilUsuario[] },
    loadComponent: () => import('../pages/usuarios/usuarios').then((m) => m.UsuariosPage),
    title: 'Usuários',
  },
  { path: '**', redirectTo: '' },
];
