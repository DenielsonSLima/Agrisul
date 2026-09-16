export type Customer={id:string;name:string;email:string;phone:string;type:string};
export type Contract={id:string;title:string;customerId:string;value:number;date:string;status:string};
export type Event={id:string;title:string;date:string;time:string;type:string;done:boolean};
export type Settings={name:string;company:string;email:string;compact:boolean;workspaceId?:string};
