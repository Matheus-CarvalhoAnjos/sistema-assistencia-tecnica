import { PerfilUsuario } from './usuario-autenticado';

/** Usuário como devolvido pela API (nunca inclui senha ou hash). */
export interface Usuario {
  id_usuario: number;
  nome: string;
  email: string;
  perfil: PerfilUsuario;
  ativo: number | boolean;
}

/** Corpo de POST /api/usuarios (senha obrigatória) e PUT /api/usuarios/:id (senha opcional). */
export interface UsuarioEntrada {
  nome: string;
  email: string;
  perfil: PerfilUsuario;
  senha?: string;
}

export const ROTULOS_PERFIL: Readonly<Record<PerfilUsuario, string>> = {
  ADMINISTRADOR: 'Administrador',
  ATENDENTE: 'Atendente',
  TECNICO: 'Técnico',
};
