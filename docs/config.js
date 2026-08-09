/* India Rec — configuração da instalação.
 *
 * ENDPOINT: o URL da aplicação web do Apps Script (termina em /exec).
 *   Ao voltar a publicar o script use "Gerir implementações > editar > nova versão",
 *   NUNCA "Nova implementação" — isso muda o URL e os telemóveis já instalados
 *   deixam de conseguir enviar.
 *
 * O código de activação (TOKEN) NÃO fica aqui: este ficheiro é público.
 * Cada telemóvel escreve-o uma vez no primeiro arranque e fica guardado no aparelho.
 */
window.INDIAREC_CONFIG = {
  ENDPOINT: 'https://script.google.com/macros/s/AKfycbxNPOm3OJoVADngytixFlnukdfpSo0wYth70BkWi3scfG3Hq21QrLY46bnfkcD6tuEV/exec',
  VERSAO: '1.0.2'
};
