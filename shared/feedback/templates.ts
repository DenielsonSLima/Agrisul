import type {NotificationKind} from './models';

export const notificationTemplates:Record<NotificationKind,{title:string;description:string}>={
 created:{title:'Cadastro concluído',description:'O novo registro foi salvo.'},
 updated:{title:'Atualização concluída',description:'As alterações foram salvas.'},
 saved:{title:'Alterações salvas',description:'Os dados foram atualizados com sucesso.'},
 deleted:{title:'Exclusão concluída',description:'O registro foi excluído.'},
 error:{title:'Não foi possível concluir',description:'Revise os dados e tente novamente.'},
};
