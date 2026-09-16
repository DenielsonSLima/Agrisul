import {toast} from 'sonner';
import type {NotificationKind,NotificationOptions} from './models';
import {notificationTemplates} from './templates';

function show(kind:NotificationKind,options:NotificationOptions={}){
 const template=notificationTemplates[kind];
 const config={description:options.description??template.description,duration:options.duration??4500};
 if(kind==='error')return toast.error(template.title,config);
 return toast.success(template.title,config);
}

export const notifications={
 created:(description?:string)=>show('created',{description}),
 updated:(description?:string)=>show('updated',{description}),
 saved:(description?:string)=>show('saved',{description}),
 deleted:(description?:string)=>show('deleted',{description}),
 error:(description?:string)=>show('error',{description,duration:6000}),
 dismiss:()=>toast.dismiss(),
};
