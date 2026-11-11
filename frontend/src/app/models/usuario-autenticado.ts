export type PerfilUsuario = 'ADMINISTRADOR' | 'ATENDENTE' | 'TECNICO';

export interface UsuarioAutenticado {
  id_usuario: number;
  nome: string;
  email: string;
  perfil: string;
}

/** Corpo enviado para POST /api/auth/login. */
export interface CredenciaisLogin {
  email: string;
  senha: string;
}

/** Resposta de sucesso de POST /api/auth/login. */
export interface RespostaLogin {
  mensagem: string;
  usuario: UsuarioAutenticado;
  token: string;
}
