import { HttpErrorResponse } from '@angular/common/http';

/** Converte um erro HTTP da API ({ mensagem }) em texto para exibir ao usuário. */
export function mensagemDeErro(erro: unknown): string {
  if (!(erro instanceof HttpErrorResponse)) {
    return 'Ocorreu um erro inesperado. Tente novamente.';
  }

  if (erro.status === 0) {
    return 'Não foi possível conectar ao servidor. Verifique se a API está em execução.';
  }

  const mensagem = (erro.error as { mensagem?: unknown } | null)?.mensagem;
  if (typeof mensagem === 'string' && mensagem.trim()) {
    return mensagem;
  }

  if (erro.status === 403) {
    return 'Você não possui permissão para realizar esta ação.';
  }
  if (erro.status === 429) {
    return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  }
  return 'Ocorreu um erro no servidor. Tente novamente.';
}
